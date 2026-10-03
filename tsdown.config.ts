import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { defineConfig } from 'tsdown'

/** Entry name the browser loader looks the package up by. */
const PACKAGE_ID = '@audsiui/dsh-minimax-coding-plan'

/** Marker id for the one stylesheet this package owns. */
const CSS_PREFIX = '\0minimax-css:'

/**
 * A class selector: a dot followed by an identifier that cannot start with a
 * digit. That is what keeps `0.5px`, `0.999` and `1.5` out of the rewrite.
 */
const CLASS_SELECTOR = /\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g

/**
 * Turn a `.module.css` import into a scoped class map plus a live `<style>`.
 *
 * Two rules from `docs/web-styling.zh.md` shape this: component styles are CSS
 * Modules living beside the component (`:11`, `:17`), and `./client` has to be
 * a single lazy-CJS script with no second request
 * (`docs/cookbook/adding-a-settings-card.zh.md:60`). Extracting to a sibling
 * `style.css` would satisfy neither — the page would load unstyled with no
 * error to say so.
 *
 * The scoping pass is deliberately small: it rewrites class selectors in a file
 * this package authors, and that file uses no `:global`, no nesting, and no
 * `url()` or string literal that could hide a dot. Comments are stripped first
 * so a commented-out selector cannot be renamed.
 */
const inlineStylesheet = {
  name: 'minimax-inline-stylesheet',
  resolveId(source: string, importer?: string) {
    if (!source.endsWith('.css') || importer === undefined) return null
    // `source` is relative to whoever imported it, and that importer lives in
    // the emitted tree, not the source tree — which is what build/copy-client-
    // assets.mjs puts the stylesheet next to. The `.css` suffix is dropped from
    // the id: a virtual id that still ends in `.css` is claimed by rolldown's own
    // stylesheet pipeline before this hook is consulted.
    return CSS_PREFIX + resolve(dirname(importer), source).slice(0, -'.css'.length)
  },
  load(id: string) {
    if (!id.startsWith(CSS_PREFIX)) return null
    const file = `${id.slice(CSS_PREFIX.length)}.css`
    const source = readFileSync(file, 'utf8')
    // Hashed from the package-relative path so the name is stable across builds
    // and still distinct from any other file's classes.
    const hash = createHash('sha256')
      .update(relative(resolve(import.meta.dirname, '..'), file).split('\\').join('/'))
      .digest('hex')
      .slice(0, 8)

    const names = new Set<string>()
    for (const match of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(CLASS_SELECTOR)) {
      names.add(match[1]!)
    }
    const classes: Record<string, string> = {}
    for (const name of names) classes[name] = `${name}_${hash}`

    const scoped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(CLASS_SELECTOR, (_, name: string) => `.${classes[name] ?? name}`)

    const selector = `"style[data-plugin-css=${JSON.stringify(PACKAGE_ID)}]"`
    return [
      `const css=${JSON.stringify(scoped)};`,
      `const classes=${JSON.stringify(classes)};`,
      `const selector='${selector}';`,
      'export function disposeStylesheet(){',
      '  if(typeof document==="undefined")return;',
      '  const el=document.querySelector(selector);',
      '  if(el)el.remove();',
      '}',
      'if(typeof document!=="undefined"&&!document.querySelector(selector)){',
      '  const el=document.createElement("style");',
      `  el.dataset.pluginCss=${JSON.stringify(PACKAGE_ID)};`,
      '  el.textContent=css;',
      '  document.head.appendChild(el);',
      '}',
      'export default classes;',
    ].join('\n')
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
    minify: true,
    fixedExtension: false,
    deps: {
      neverBundle: PLATFORM_MODULES,
      // Everything the platform does not already provide is ours to ship.
      alwaysBundle: (id: string) => !PLATFORM_MODULES.includes(id),
    },
    plugins: [inlineStylesheet],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({id:${JSON.stringify(PACKAGE_ID)},factory:(require)=>{`,
      intro: 'var module={exports:{}};var exports=module.exports;',
      footer: 'return module.exports;}});',
    },
  },
])
