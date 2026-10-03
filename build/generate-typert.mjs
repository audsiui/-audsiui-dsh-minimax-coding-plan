// Generate this package's Typert Host and Host-for-Client artifacts.
//
// dsh runs its own Typert generator inside its monorepo root build, where the
// match set is its own package layout. A package installed from git is not in
// that set, so nothing would ever be generated for it. The generator itself,
// however, is an ordinary published package, and this script drives it the way
// that build would: stand up a minimal workspace whose shape the analyzer
// expects, point its tsconfig at the real declarations, and emit.
//
// The shape it wants is a `packages/<id>/` directory with its own tsconfig and
// manifest, plus a sibling `typert-protocol` package whose `src` is the
// shipped `lib/types` tree. The scratch workspace is created inside this
// project so ordinary Node module resolution walks up from it into the real
// `node_modules` — see `scratch` below for why that is not a symlink.
//
// Run via `npm run generate:typert`. It writes src/generated/, which is
// committed: a git install must build nothing.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FaceModelEmitter, WorkspaceAnalyzer } from '@deepseek-ai/dsh-typert-generator'

const PACKAGE_ID = '@audsiui/dsh-minimax-coding-plan'
/** Matches the real manifest name; the scratch workspace keeps it too. */
const WORKSPACE_ID = PACKAGE_ID

const root = resolve(import.meta.dirname, '..')

/**
 * The scratch workspace lives *inside* the project rather than in the system
 * temp directory, because that removes the need to link `node_modules` at all:
 * resolution from `<scratch>/packages/<id>/` walks up through the scratch
 * directories and reaches the real install. A symlink is the obvious way to do
 * this and it does not work here — Windows refuses `symlink` without Developer
 * Mode, and that failure would make the generator look broken on a machine
 * where it is not.
 */
const scratch = resolve(root, '.typert-workspace')

/**
 * Parse a JSONC file: the tsconfigs carry explanatory comments, and
 * `JSON.parse` rejects them. Comments are stripped by scanning rather than by
 * regex so a `//` inside a string literal — a specifier, a URL — survives.
 * @param {string} path - absolute file path.
 * @returns {Promise<any>} the parsed document.
 */
async function readJsonc(path) {
  const text = await readFile(path, 'utf8')
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++ }
      continue
    }
    if (inString) {
      out += ch
      if (ch === '\\') { out += next ?? ''; i++ }
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    if (ch === '/' && next === '/') { inLine = true; i++; continue }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue }
    out += ch
  }
  return JSON.parse(out)
}

const temporary = scratch
const packageRoot = join(temporary, 'packages', WORKSPACE_ID)
const protocolRoot = join(temporary, 'packages', 'typert-protocol')

try {
  await rm(temporary, { recursive: true, force: true })
  await Promise.all([
    mkdir(join(root, 'src', 'generated'), { recursive: true }),
    mkdir(packageRoot, { recursive: true }),
    mkdir(protocolRoot, { recursive: true }),
  ])

  const [hostConfig, manifest] = await Promise.all([
    readJsonc(resolve(root, 'tsconfig.host.json')),
    readJsonc(resolve(root, 'package.json')),
  ])

  // The analyzer resolves `@deepseek-ai/dsh-typert-protocol` through the real
  // `paths`; overriding it to the copied `src` is what makes the copied
  // declaration tree authoritative instead of the package's own lib layout.
  hostConfig.compilerOptions = {
    ...hostConfig.compilerOptions,
    paths: {
      '@deepseek-ai/dsh-typert-protocol': ['../typert-protocol/src/index.d.ts'],
    },
  }

  // The manifest is passed through **as written**. `docs/api-gateway.zh.md:113`
  // states the generator validates the package exports and the published file
  // list, and only emits for a package carrying the right entries — so the
  // `./typert` and `./remote` conditions and their `files` rows are exactly the
  // input that check exists to consume. An earlier version of this script
  // declared them into the copy it inspects, which meant the check ran against
  // values the script had just written and could not fail on a manifest that
  // was actually wrong. `validateExport` is only reachable from inside the
  // analyzer's own generate pass, never from here.
  //
  // The analyzer validates every declared export against a source file, and it
  // maps `lib/<name>.js` back to `src/<name>.ts`. The browser half ships as
  // `lib/client.js`, which that mapping resolves to a `src/client.ts` that
  // does not exist — the real client entry is a directory, and it is built
  // into the browser bundle rather than emitted by the Host program. It is
  // browser-only and the Host face never reads it, so it is withheld from the
  // copy the analyzer inspects. The real manifest keeps it.
  delete manifest.exports['./client']

  // The analyzer selects a package by manifest name, and the emitted client
  // declarations import their wire types as `<name>/types`. The scratch
  // manifest therefore keeps the real scoped name — rewriting the generated
  // output afterwards would mean shipping something the generator did not
  // produce. A scoped name is also a nested directory, which is why the
  // workspace path carries a scope segment.
  manifest.name = WORKSPACE_ID

  await Promise.all([
    cp(resolve(root, 'src'), join(packageRoot, 'src'), { recursive: true }),
    cp(resolve(root, 'tsconfig.base.json'), join(packageRoot, 'tsconfig.base.json')),
    cp(
      resolve(root, 'node_modules/@deepseek-ai/dsh-typert-protocol/lib/types'),
      join(protocolRoot, 'src'),
      { recursive: true },
    ),
    writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(packageRoot, 'tsconfig.host.json'), `${JSON.stringify(hostConfig, null, 2)}\n`),
    writeFile(join(protocolRoot, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-typert-protocol',
      type: 'module',
      exports: { '.': './src/index.d.ts' },
    }, null, 2)}\n`),
    writeFile(join(protocolRoot, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        target: 'ES2024',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
      },
      include: ['src'],
    }, null, 2)}\n`),
    // The solution file is what turns the directory layout into a project
    // graph: without these references the analyzer sees no host program.
    writeFile(join(temporary, 'tsconfig.host.json'), `${JSON.stringify({
      files: [],
      compilerOptions: {
        target: 'ES2024',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        paths: {
          '@deepseek-ai/dsh-typert-protocol': ['./packages/typert-protocol/src/index.d.ts'],
        },
      },
      references: [
        { path: `./packages/${WORKSPACE_ID}/tsconfig.host.json` },
        { path: './packages/typert-protocol/tsconfig.json' },
      ],
    }, null, 2)}\n`),
  ])

  const workspace = new WorkspaceAnalyzer({
    root: temporary,
    packages: [WORKSPACE_ID],
    faces: ['host'],
  }).analyze()

  const face = workspace.faces.find(candidate => candidate.face === 'host')
  if (face === undefined) {
    const summary = {
      workspaceKeys: Object.keys(workspace),
      faces: workspace.faces.map(f => ({ face: f.face, keys: Object.keys(f).slice(0, 12) })),
      packages: workspace.packages?.map?.(p => ({ name: p.name, id: p.id, rootDir: p.rootDir })) ?? workspace.packages,
    }
    throw new Error(`the analyzer produced no host face: ${JSON.stringify(summary, null, 2)}`)
  }

  const artifact = new FaceModelEmitter(face).emit(WORKSPACE_ID)
  if (artifact === undefined || artifact.remote === undefined) {
    throw new Error('Typert emitted no Remote artifacts: the @Remote methods were not found')
  }

  // Exactly the five artifacts `docs/api-gateway.zh.md:105-111` names, no sixth.
  // A `remote-augmentation.d.ts` was written here once, byte-for-byte identical
  // to `typert.remote-client.d.ts`; it shipped a file nothing declared and that
  // the table does not list.
  //
  // `lib/` is emptied by build/clean.mjs before every build, so the generator's
  // output is kept in src/generated/ and build/copy-assets.mjs puts the three
  // declaration artifacts where `exports` and `files` point. Emitting them
  // anywhere else would leave `exports` naming files that do not exist, and the
  // only documented route by which a consumer picks up the declaration merge
  // (`docs/api-gateway.zh.md:78`) would silently resolve to nothing.
  await Promise.all([
    writeFile(resolve(root, 'src/generated/host.ts'), artifact.js),
    writeFile(resolve(root, 'src/generated/remote.ts'), artifact.remote.js),
    writeFile(resolve(root, 'src/generated/typert.host.d.ts'), artifact.dts),
    writeFile(resolve(root, 'src/generated/typert.remote-client.d.ts'), artifact.remote.dts),
    writeFile(resolve(root, 'src/generated/typert.remote-client.d.ts.map'), artifact.remote.dtsMap),
  ])

  const endpoints = [...artifact.remote.js.matchAll(/["'`]([a-z]+)\/([a-z]+)["'`]/gu)]
    .map(match => `${match[1]}/${match[2]}`)
  console.log(`generated for ${PACKAGE_ID}: ${artifact.js.split('\n').length} host lines, `
    + `${artifact.remote.js.split('\n').length} client lines, endpoints: ${[...new Set(endpoints)].join(', ') || '(none)'}`)
}
finally {
  await rm(temporary, { recursive: true, force: true })
}
