import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'
import { transform } from 'lightningcss'
import { RolldownMagicString } from 'rolldown'
import { defineConfig } from 'tsdown'

/** Plugin id, stamped into the __ModuleLoader__ handoff and onto injected tags. */
const PACKAGE_ID = '@audsiui/dsh-minimax-coding-plan'

/**
 * Virtual-id wrappers keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual ids must not.
 *
 * These constants, the plugins below, and the whole client config restate
 * `packages/client/tsdown.client.ts` — the `clientBundle` preset that
 * `docs/cookbook/adding-a-settings-card.zh.md:60` names as the way a package
 * outside this repository builds its browser half. The preset is not published,
 * so the recipe is copied rather than reinvented.
 *
 * Two earlier versions of this file were wrong in ways the copy fixes. One
 * hand-rolled the query selector by concatenating an already-quoted attribute
 * value, and shipped `"style[data-plugin-css="…"]"`, which is not a selector. The
 * other implemented four pieces of the preset and called that a reproduction:
 * an omitted purity gate lets a cross-plugin value import inline a second copy
 * of someone else's runtime instead of failing the build, and omitted
 * `define` / `chunkFileNames` / `banner`-as-a-function only stay invisible while
 * the bundle happens to contain no `import()` and no `process.env` reader.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

/** Path segment separating this package's tsc output from the sources it came from. */
const TYPES_MARKER = `${sep}lib${sep}client-types${sep}`

/** Trailing sourcemap reference tsc appends to every emitted module. */
const SOURCEMAP_COMMENT = /\n\/\/# sourceMappingURL=.*\s*$/

/**
 * Wire layers with values but no shared runtime identity — no Symbol, no
 * instanceof, no singleton state. Copied verbatim from
 * `packages/client/tsdown.client.ts:64`; inlining a second copy of one of these
 * is correct, which is exactly why the purity gate below lets them through.
 */
const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|session|llm|tools|brand|deque|output-retention|typert-protocol|util-crypto|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-native-command\/types$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-plugin-manager\/registry$|@deepseek-ai\/dsh-agent-preset-registry\/display$|@deepseek-ai\/dsh-api-workspace-controller\/default-workspace$|@deepseek-ai\/dsh-spill-policy\/notice$)/

/** Vendored framework libraries rescoped under `@deepseek-ai`; ordinary libraries to a browser bundle. */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * Resolve an emitted-JS asset import against its source-tree counterpart.
 * @param source - relative import specifier as written in the source.
 * @param importer - absolute path of the importing module, emitted or source.
 * @returns the stylesheet on disk.
 */
function sourceAssetPath(source: string, importer: string): string {
  if (!source.startsWith('.') && !isAbsolute(source)) return createRequire(importer).resolve(source)
  const emitted = resolve(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

/**
 * Emit one plugin-owned style injector and the CSS Modules class map.
 *
 * The selector is assembled by concatenating a quoted attribute value onto a
 * quoted attribute name, never by wrapping an already-quoted value in quotes of
 * its own. Both dataset keys are written: `data-plugin` identifies the owning
 * entry, `data-plugin-css` identifies this stylesheet within it, and the module
 * system reclaims the tag through them
 * (`packages/client/modules/README.zh.md`, entry-lifecycle reclaims a module's
 * own styles) — so the entry does not dispose of the tag itself.
 *
 * @param id - owning plugin id.
 * @param fileId - absolute path of the physical stylesheet.
 * @param css - compiled stylesheet text.
 * @param classMap - local name to scoped name, for a CSS Modules import.
 * @returns the module source.
 */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** CSS Modules: hash the classes with lightningcss and inject the result. */
const cssModulesInline = {
  name: 'dsh-css-modules-inline',
  resolveId(source: string, importer?: string) {
    if (!source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
    return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(this: { addWatchFile: (file: string) => void }, virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    // Otherwise the virtual id hides the physical stylesheet from the watch graph.
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    const exportEntries = Object.entries(cssExports ?? {})
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    for (const [local, exported] of exportEntries) classMap[local] = exported.name
    return styleInjectionModule(PACKAGE_ID, fileId, code.toString(), classMap)
  },
}

/**
 * `x.css?inline` — the stylesheet as a string, for a caller that wants the text
 * rather than a tag. `packages/client/tsdown.client.ts:570-585`.
 */
const cssTextInline = {
  name: 'dsh-css-text-inline',
  resolveId(source: string, importer?: string) {
    if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
    const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
    const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet
    return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(this: { addWatchFile: (file: string) => void }, virtualId: string) {
    if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code } = transform({ filename: fileId, code: source, minify: true })
    return `export default ${JSON.stringify(code.toString())};`
  },
}

/**
 * A plain `x.css` — injected globally, and deliberately exporting nothing.
 * `styleInjectionModule` omits the class map here, so the module source ends in
 * `export {};` (`packages/client/tsdown.client.ts:54`); a default export
 * declared for it in `src/css.d.ts` would resolve to `undefined` at runtime.
 * `packages/client/tsdown.client.ts:586-600`.
 */
const cssGlobalInline = {
  name: 'dsh-css-global-inline',
  resolveId(source: string, importer?: string) {
    if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
    return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  async load(this: { addWatchFile: (file: string) => void }, virtualId: string) {
    if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code } = transform({ filename: fileId, code: source, minify: true })
    return styleInjectionModule(PACKAGE_ID, fileId, code.toString())
  },
}

/**
 * The bundle purity gate — the build-time mirror of the module-edge rules.
 *
 * A requested module-table row stays external, an inline-safe wire layer and a
 * vendored library inline, and every other `@deepseek-ai` value import fails
 * the build. Without it a cross-plugin value import is not a build error: it
 * either inlines a duplicate runtime instance that registers into a table
 * nothing reads, or leaves a specifier the frozen module table cannot answer,
 * which is a guaranteed throw at factory execution.
 * `packages/client/tsdown.client.ts:526-544`.
 */
const clientBundlePurity = {
  name: 'dsh-client-bundle-purity',
  resolveId(source: string) {
    if (!source.startsWith('@deepseek-ai/')) return null
    if (PLATFORM_MODULES.includes(source)) return null // requested module-table row: external wins
    if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
    if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
    throw new Error(
      `client bundle purity: "${source}" is not in the default client externals or ${PACKAGE_ID}'s dsh.client.external, `
      + 'an inline-safe wire layer, or a generated /remote contribution — cross-plugin value imports are forbidden; '
      + 'declare a non-default module request or collaborate through cordis services '
      + '(type-only imports are erased and never reach this gate)',
    )
  },
}

/**
 * Chain tsc's emitted maps into the client bundle, so a browser frame lands on
 * the TSX rather than on the emitted JavaScript.
 *
 * Without this the bundle's own map lists only `lib/client-types/**` — which is
 * what the committed `lib/client.js.map` did: 24 sources, not one of them
 * `.ts` or `.tsx`. tsc strips its `sourceMappingURL` comment on the way in,
 * because the map it returns replaces it.
 * `packages/client/tsdown.client.ts:681-711`.
 */
function tscSourceMapPlugin() {
  return {
    name: 'dsh-tsc-sourcemap',
    async load(id: string) {
      if (!id.includes(TYPES_MARKER) || !id.endsWith('.js') || !existsSync(`${id}.map`)) return null
      const code = await readFile(id, 'utf8')
      const mapPath = `${id}.map`
      const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
        sourceRoot?: unknown
        sources?: unknown
        sourcesContent?: unknown
        [key: string]: unknown
      }
      if (!Array.isArray(map.sources) || map.sources.some(source => typeof source !== 'string')) {
        throw new Error(`client sourcemap: ${mapPath} has invalid sources`)
      }
      const sources = map.sources as string[]
      if (
        !Array.isArray(map.sourcesContent)
        || map.sourcesContent.length !== sources.length
        || map.sourcesContent.some(source => typeof source !== 'string')
      ) {
        // tsc omits sourcesContent; read the authored files back off disk so the
        // browser has something to show without a route into the source tree.
        const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : ''
        map.sourcesContent = await Promise.all(sources.map(async source =>
          await readFile(resolve(dirname(mapPath), sourceRoot, source), 'utf8')))
      }
      return { code: code.replace(SOURCEMAP_COMMENT, ''), map }
    },
  }
}

/** Escape a specifier for embedding in the RegExp below. */
function escapeSpecifier(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Render package-local dynamic imports through the Client module loader's
 * asynchronous operation.
 *
 * The loader's `require` bridge has no synchronous chunk story, so a split
 * `import()` must become `require.async("./client.<name>.js")`
 * (`packages/client/modules/README.zh.md:38`). A chunk that does not match the
 * naming convention is a build error, not a silent `require` the bridge cannot
 * satisfy. `packages/client/tsdown.client.ts:436-459`.
 *
 * The preset's `writeBundle` half, which touches the entry's mtime to defeat a
 * bundler cache, is omitted: it is an incremental-build trick for the monorepo
 * and carries no module-system contract.
 */
function asyncChunkRequirePlugin() {
  return {
    name: 'dsh-client-async-chunk-require',
    renderChunk(code: string, chunk: { dynamicImports: string[] }, outputOptions: { format?: string }) {
      if (outputOptions.format !== 'cjs') return null
      const transformed = new RolldownMagicString(code)
      for (const dynamicImport of chunk.dynamicImports) {
        const fileName = dynamicImport.startsWith('./') ? dynamicImport.slice(2) : dynamicImport
        if (!/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(fileName)) continue
        const specifier = `./${fileName}`
        const call = new RegExp(
          `Promise\\.resolve\\(\\)\\.then\\(\\(\\)\\s*=>\\s*require\\((['"])${escapeSpecifier(specifier)}\\1\\)\\)`,
          'gu',
        )
        const matches = [...code.matchAll(call)]
        if (matches.length === 0) {
          throw new Error(`client bundle compiler: dynamic chunk ${JSON.stringify(specifier)} has no generated import expression`)
        }
        for (const match of matches) {
          transformed.overwrite(match.index, match.index + match[0].length, `require.async(${JSON.stringify(specifier)})`)
        }
      }
      return transformed.hasChanged() ? transformed : null
    },
  }
}

/**
 * Modules the shell already provides. They are `external` in the browser build
 * because a second copy of React, Cordis, or the slot registry would be a
 * *different* registry than the one rendering the page — the entries would
 * register into a table nothing reads.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-typert-protocol',
]

/**
 * Four outputs from one build.
 *
 * The two `tsc` passes run first (`npm run build:lib`), because tsdown
 * bundles from emitted JavaScript rather than from source: the Typert
 * generator's artifacts are generated TypeScript, and the browser half is
 * compiled against a different set of peer declarations than the Host.
 *
 * Every `@deepseek-ai/*` dependency stays external on the Host side. These are
 * the host's singletons: the running harness owns one instance of each, and a
 * second copy inside this bundle would break identity. That matters most for
 * `@deepseek-ai/schemastery`, whose schema objects are compared by instance —
 * a bundled copy would produce schemas the host's loader cannot recognise.
 */
export default defineConfig([
  {
    // The plugin entry the harness Loader activates.
    name: 'minimax:plugin',
    entry: { index: 'lib/types/index.js' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    // Cleaned once by build/clean.mjs, before the tsc passes run — see that
    // file for why a per-config clean would delete tsc's own output.
    clean: false,
    // `package.json#main` names `lib/index.js`; without this the ESM-only
    // build emits `index.mjs` and the loader's entry lookup misses.
    fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
  ...[
    ['typert-host', 'typert.host', 'lib/types/generated/host.js'],
    ['typert-remote', 'typert.remote-client', 'lib/types/generated/remote.js'],
  ].map(([name, output, entry]) => ({
    name: `minimax:${name}`,
    entry: { [output!]: entry! },
    outDir: 'lib',
    format: 'esm' as const,
    platform: 'node' as const,
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    fixedExtension: false,
    // `zod` is external for the same reason as the `@deepseek-ai/*` scope: the
    // generated Typert artifacts import it for their strict schemas, and the
    // Typert registry in the running host owns the one instance those schemas
    // are compiled against. Bundling a second copy inflates this entry from
    // about 4 kB to 181 kB *and* would make the schemas unrecognisable to the
    // host that has to accept them.
    deps: { neverBundle: [/^@deepseek-ai\//, 'zod'] },
  })),
  {
    // The browser half. CommonJS with the module loader's three-part contract
    // because that is the only shape the browser `require` bridge accepts: the
    // banner registers a factory, the intro gives that factory its own
    // `module`/`exports` pair, and the footer hands the result back. Anything
    // else loads as a script that exports nothing.
    name: 'minimax:client',
    entry: { client: 'lib/client-types/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    // The preset does not minify the JavaScript either: minification renames
    // the private `module`/`exports` pair the loader contract depends on, and
    // the stylesheet is already minified by lightningcss above.
    fixedExtension: false,
    deps: {
      neverBundle: PLATFORM_MODULES,
      // Everything the platform does not already provide is ours to ship.
      alwaysBundle: (id: string) => !PLATFORM_MODULES.includes(id),
    },
    // Dual-mode libraries (lexical's exports carry development/production/node
    // conditions; the node file picks its flavor with a top-level await a CJS
    // bundle cannot carry) resolve their static flavor matching the NODE_ENV the
    // defines below bake in. `packages/client/tsdown.client.ts:502-509`.
    inputOptions: {
      resolve: {
        conditionNames: [
          (process.env.NODE_ENV ?? 'production') === 'development' ? 'development' : 'production',
          'browser', 'import', 'module', 'default',
        ],
      },
    },
    // A browser bundle inlines node-idiom deps — zod and clsx are both in this
    // bundle today — and those read `process.env.NODE_ENV` or probe
    // `import.meta.env`. Vite defined both on the seed path; tsdown inlining
    // needs the substitutions here or the factory throws ReferenceError at boot.
    // The bare `import.meta.env` key is required alongside the precise MODE key:
    // a truthiness probe on it would otherwise survive as an empty import.meta.
    // `packages/client/tsdown.client.ts:510-525`.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [clientBundlePurity, tscSourceMapPlugin(), asyncChunkRequirePlugin(), cssModulesInline, cssTextInline, cssGlobalInline],
    outputOptions: {
      entryFileNames: 'client.js',
      // A split chunk is fetched as `./client.<name>.js` by the loader bridge,
      // and the name has to be pinned or the request misses.
      chunkFileNames: 'client.[name].js',
      // The map is served from /plugins/<scoped-package>/client.js.map and has to
      // carry the authored sources, or the browser shows emitted JavaScript.
      sourcemapExcludeSources: false,
      // The three-part handoff, spelled as `packages/client/tsdown.client.ts`
      // spells it. A bundle that does not open with the registration, or that
      // closes without returning the private exports, loads as a script that
      // exports nothing — and that surfaces as a plugin row that simply never
      // registers. A non-entry chunk also has to name itself, or the loader
      // registers it as a second copy of the entry.
      // `packages/client/tsdown.client.ts:616-622`.
      banner: (chunk: { isEntry: boolean, fileName: string }) =>
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, `
        + `${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
