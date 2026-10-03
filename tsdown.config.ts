import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

/** Plugin id, stamped into the __ModuleLoader__ handoff and onto injected tags. */
const PACKAGE_ID = '@audsiui/dsh-minimax-coding-plan'

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not.
 *
 * These four constants and the two helpers below reproduce
 * `packages/client/tsdown.client.ts` — the `clientBundle` preset that
 * `docs/cookbook/adding-a-settings-card.zh.md:60` names as the way a package
 * outside this repository builds its browser half. The preset is not published,
 * so the recipe is restated here rather than reinvented: an earlier hand-rolled
 * version of this file built the query selector by string concatenation of an
 * already-quoted attribute value and shipped `"style[data-plugin-css="…"]"`,
 * which is not a selector, and it stamped only one of the two dataset keys the
 * module system reads when it reclaims a module's own styles.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Path segment separating this package's tsc output from the sources it came from. */
const TYPES_MARKER = `${sep}lib${sep}client-types${sep}`

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
    plugins: [cssModulesInline],
    outputOptions: {
      entryFileNames: 'client.js',
      // The three-part handoff, spelled as `packages/client/tsdown.client.ts`
      // spells it. A bundle that does not open with the registration, or that
      // closes without returning the private exports, loads as a script that
      // exports nothing — and that surfaces as a plugin row that simply never
      // registers.
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
