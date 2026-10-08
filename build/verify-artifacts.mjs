// Fail when the committed artifacts are not what the sources produce.
//
// This package ships two committed generated trees, and neither is produced by
// `npm run build`: `lib/` is the tsc + tsdown output, and `src/generated/` is the
// Typert artifact that only `npm run generate:typert` writes. A commit can
// therefore leave either stale, and the staleness is invisible — `build` succeeds,
// `typecheck` succeeds, and the damage surfaces only where the artifact is
// actually read:
//
//   - a stale `lib/` ships yesterday's plugin to every git installer, which no
//     longer rebuilds on install;
//   - a stale `src/generated/` ships Remote codecs and the agent-facing service
//     model that describe methods and signatures the code no longer has.
//
// Both are checked here, in the order they are produced: regenerate first, then
// build, because the declaration artifacts in `src/generated/` are copied into
// `lib/` by the build and a comparison done in the other order would report the
// copy as drift.
//
// The committed trees are snapshotted first and restored whatever happens, so a
// failing run leaves the working copy exactly as it found it and reports what
// drifted. Running it in CI turns the failure from "a user noticed" into "the
// push failed".
//
// A byte comparison is the right level: tsc, tsdown and the generator are
// deterministic for a fixed input tree, so any difference is a real one — a stale
// artifact, a source edit that was not rebuilt, or a toolchain bump.
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** The two committed trees, in the order they are produced. */
const TREES = ['src/generated', 'lib']

async function run(command) {
  // `shell` is required on Windows, where npm is a .cmd shim that spawn() refuses
  // to execute directly. Both commands are literals, so nothing is interpolated.
  const child = spawn(command, { cwd: root, stdio: 'inherit', shell: true })
  return new Promise((done) => child.on('close', done))
}

async function digestTree(dir) {
  const out = new Map()
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        out.set(relative(dir, full).split(sep).join('/'), createHash('sha256')
          .update(await readFile(full)).digest('hex'))
      }
    }
  }
  await walk(dir)
  return out
}

/** Compare one tree against its snapshot, labelling differences by tree. */
function diff(label, before, after) {
  const changed = []
  for (const [file, hash] of after) {
    if (!before.has(file)) changed.push(`  + ${label}/${file} (new)`)
    else if (before.get(file) !== hash) changed.push(`  ~ ${label}/${file} (changed)`)
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(`  - ${label}/${file} (missing)`)
  }
  return changed
}

const snapshot = await mkdtemp(join(tmpdir(), 'dsh-verify-'))
const before = new Map()
for (const tree of TREES) {
  const target = join(snapshot, tree)
  await cp(join(root, tree), target, { recursive: true })
  before.set(tree, await digestTree(target))
}

async function restore() {
  for (const tree of TREES) {
    await rm(join(root, tree), { recursive: true, force: true })
    await cp(join(snapshot, tree), join(root, tree), { recursive: true })
  }
}

const generated = await run('npm run generate:typert')
const built = generated === 0 ? await run('npm run build') : generated

let after
try {
  after = new Map()
  for (const tree of TREES) after.set(tree, await digestTree(join(root, tree)))
} finally {
  await restore()
}
await rm(snapshot, { recursive: true, force: true })

if (built !== 0) {
  console.error('verify-artifacts: generation or build failed; the committed trees were restored')
  process.exit(built ?? 1)
}

const changed = TREES.flatMap(tree => diff(tree, before.get(tree), after.get(tree)))

if (changed.length === 0) {
  const total = [...after.values()].reduce((sum, files) => sum + files.size, 0)
  console.log(`verify-artifacts: ${TREES.join(' and ')} match the sources (${total} files)`)
} else {
  console.error('verify-artifacts: the committed artifacts do not match the sources:')
  for (const line of changed) console.error(line)
  console.error('\nRun `npm run generate:typert && npm run build`, then commit the result'
    + ' in the same commit as the src/ change.')
  process.exit(1)
}
