// Assert the browser bundle's shape, so a bundler change that breaks the
// loader contract fails here rather than in a browser console.
//
// The lazy-CJS handoff and the stylesheet injector are restated from
// `packages/client/tsdown.client.ts`; the styling rules come from
// `docs/web-styling.zh.md` and `docs/ui-radius.zh.md`. Both are the things a
// future edit breaks silently: a wrong token or a missing `corner-shape`
// pairing renders wrong rather than erroring, and a malformed selector throws
// only once the bundle reaches a real document.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const PACKAGE_ID = '@audsiui/dsh-minimax-coding-plan'
const source = readFileSync(resolve(import.meta.dirname, 'lib/client.js'), 'utf8')
const stylesheet = readFileSync(resolve(import.meta.dirname, 'src/client/MinimaxPage.module.css'), 'utf8')

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}

// --- The loader contract ------------------------------------------------------------
//
// Executing the bundle was broken once by a selector that merely *contained* the
// right text, and a check that only greps the bundle cannot see that. This runs
// the artifact and materialises it, because that is the only point at which the
// stylesheet injector executes: the lazy-CJS model registers a factory and does
// not call it (`packages/client/modules/README.zh.md`), so a check that stops at
// `load()` never reaches `querySelector` and would pass on any selector at all.
//
// The DOM stub rejects any attribute selector that is not well formed, which is
// the same failure the page raised.
const VALID_SELECTOR = /^style\[data-plugin-css="[^"]+"\]$/
// The shell's module table answers the platform rows; a permissive stand-in is
// enough because the module bodies only *reference* these bindings.
const standIn = new Proxy(function () {}, {
  get: (target, key) => (key === 'default' || key === '__esModule' ? standIn : standIn),
  apply: () => standIn,
  construct: () => standIn,
})
const injected = []
let loaded
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(registration) {
        loaded = registration
        // Materialise: this is what first import does, and what makes the
        // stylesheet injector's querySelector run.
        registration.factory(() => standIn)
      },
    },
  },
  document: {
    createElement: () => ({ dataset: {} }),
    querySelector(selector) {
      if (!VALID_SELECTOR.test(selector)) {
        throw new SyntaxError(`'${selector}' is not a valid selector`)
      }
      return null
    },
    head: { appendChild: (tag) => injected.push(tag) },
  },
}
let executed = true
try {
  vm.runInNewContext(source, sandbox)
} catch (error) {
  executed = false
  check('the bundle materialises and its stylesheet selector is valid', false, error.message)
}
if (executed) {
  check('the bundle materialises and its stylesheet selector is valid', true)
  check('it registers a factory with the module loader', typeof loaded?.factory === 'function')
  check('it names this package, so the loader maps it to the right row', loaded?.id === PACKAGE_ID)
  // Both keys the module system reads when it reclaims a module's own styles.
  check('the tag it injects carries the owning entry id',
    injected[0]?.dataset?.plugin === PACKAGE_ID)
  check('the tag it injects carries the stylesheet id',
    typeof injected[0]?.dataset?.pluginCss === 'string'
    && injected[0].dataset.pluginCss.startsWith(`${PACKAGE_ID}/`))
  check('it injects exactly one style tag', injected.length === 1)
  // The three-part lazy CJS contract. Anything else loads as a script that
  // exports nothing, and the failure surfaces as a module that is simply absent.
  // Matched on whitespace-tolerant shape: the emitted intro and footer are
  // re-printed by the bundler, so line breaks are not part of the contract.
  check('opens with a private module/exports pair',
    /var module\s*=\s*\{\s*exports:\s*\{\s*\}\s*\}\s*;\s*var exports\s*=\s*module\.exports\s*;/.test(source))
  check('closes by handing module.exports back',
    /return module\.exports\s*;\s*\}\s*\}\s*\)\s*;/.test(source))
}

// The stylesheet injector, spelled as the preset spells it: the selector is the
// attribute name concatenated with a quoted value, and both dataset keys are
// written. `data-plugin` is what identifies the owning entry and `data-plugin-css`
// the stylesheet within it, and the client module system reclaims the tag
// through them — an injector that writes only one of the two leaks a style tag
// the page can no longer collect.
check('the injector builds its selector by concatenation, not by nesting quotes',
  /querySelector\(\s*["']style\[data-plugin-css=["']\s*\+\s*JSON\.stringify\(tagId\)\s*\+\s*["']\]["']\s*\)/.test(source))
check('the injector stamps the owning entry onto the tag', /tag\.dataset\.plugin\s*=/.test(source))
check('the injector stamps the stylesheet id onto the tag', /tag\.dataset\.pluginCss\s*=/.test(source))
check('the stylesheet id carries the stylesheet file name',
  new RegExp(`tagId = "${PACKAGE_ID}/[^"]+\\.css"`).test(source))
check('injection is idempotent across remounts', /querySelector\(.*\) === null/.test(source))
check('the stylesheet is inlined into the bundle', source.includes('data-plugin-css'))
check('the stylesheet injects a <style> element', /createElement\(\s*["'`]style["'`]\s*\)/.test(source))
check('no separate stylesheet is emitted alongside the bundle', !existsSync(resolve(import.meta.dirname, 'lib/style.css')))

// --- The bundle's module graph ------------------------------------------------------
//
// The platform modules this build imports at runtime. The client only reaches
// the shell through the module loader, so anything it pulls from `@deepseek-ai/*`
// has to arrive through `require`: a bundled copy of the slot registry would be a
// *different* registry than the one rendering the page, and entries would register
// into a table nothing reads.
for (const mod of ['react', 'react/jsx-runtime']) {
  check(`${mod} is resolved through require, not bundled`,
    new RegExp(`require\\("${mod.replace('/', '\\/')}"\\)`).test(source))
}

// The surface must actually be registered, or the entry loads and does nothing.
check('mounts the generated Remote contribution', /\$mount\(/.test(source))
check('registers exactly one settings section', source.includes('settings.section'))
check('the page reaches dsh primitives, not raw elements', source.includes('SegmentedControl'))

// --- Styling rules, from the docs ---------------------------------------------------
//
// web-styling.zh.md:17 — component styles are CSS Modules, not a global sheet.
check('component styles are a CSS Module, not a global sheet',
  !/(^|\})\s*\.minimax-[\w-]/.test(stylesheet))
// lightningcss's `[hash]_[local]` pattern: a short hash, an underscore, the local
// name. Both the selector and the class map have to carry it, or `styles.page`
// resolves to a class the stylesheet never defines.
const scopedName = /"page": "([A-Za-z0-9]+_[A-Za-z0-9]+_page)"/
const mapped = scopedName.exec(source)
check('the bundle carries scoped class names', mapped !== null)
check('the stylesheet defines the class the map names', mapped !== null && source.includes(`.${mapped[1]}{`))

// web-styling.zh.md:18 — semantic tokens only, and a `var()` fallback is not a
// legal way to spell "I am not sure this token exists": it renders the wrong
// colour with nothing to say so.
const fallbacks = [...stylesheet.matchAll(/var\((--[\w-]+)\s*,/g)].map(m => m[1])
check('no var() fallback can hide a missing token', fallbacks.length === 0, fallbacks.join(', '))
const literals = [...stylesheet.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)]
check('no colour literals in component CSS', literals.length === 0,
  literals.map(m => m[0]).join(', '))

// web-styling.zh.md:29 — neutral flat borders and dividers are 0.5px hairlines.
const wideBorders = [...stylesheet.matchAll(/border(?:-top|-bottom)?:\s*(?!0\b|0\.5px|none)(\d+px)/g)]
check('neutral borders are 0.5px hairlines', wideBorders.length === 0,
  wideBorders.map(m => m[0]).join(', '))

// web-styling.zh.md:24 / ui-radius.zh.md:54 — every full-round radius pairs the
// superellipse override, or the capsule ends deform under corner-shape. Match whole
// rule blocks first: a rule's radius can appear before its curve, so a match that
// stops at the radius would never see the pairing.
const rules = [...stylesheet.matchAll(/\.[\w-]+\s*\{[^}]*\}/g)].map(m => m[0])
const fullRound = rules.filter(block => /border-radius:\s*(?:999px|50%|100%)/.test(block))
const paired = fullRound.filter(block => /corner-shape:\s*round/.test(block))
check('every full-round radius pairs corner-shape: round',
  fullRound.length > 0 && fullRound.length === paired.length,
  `${paired.length}/${fullRound.length}`)

// ui-radius.zh.md:50 — control geometry comes from the named scale, not local
// pixel values. 999px is the documented capsule exception (ui-radius.zh.md:54)
// and is what the check above guards instead.
const SCALE = new Set(['4', '8', '12', '16', '20', '28', '999'])
const localRadii = [...stylesheet.matchAll(/border-radius:\s*(\d+)px/g)]
  .filter(m => !SCALE.has(m[1]))
check('border radii come from the named scale', localRadii.length === 0,
  localRadii.map(m => m[1] + 'px').join(', '))

// web-styling.zh.md:11 — motion rides the theme's duration and curve.
check('motion uses the theme duration and curve',
  !/transition:[^;]*(?:\d+m?s|\bease\b)/.test(stylesheet.replace(/--ds-transition-duration|--ds-ease-in-out/g, '')))

// Every `--dsw-*` name the component uses has to be one the theme actually
// declares. Checked against the theme source when a dsh checkout is available;
// skipped otherwise rather than failing a build that has no theme to compare to.
const themeRoot = resolve(import.meta.dirname, '..', 'dsh', 'packages', 'client', 'ui-theme', 'src', 'styles')
if (existsSync(themeRoot)) {
  const declared = new Set()
  for (const file of ['base.css', 'design-platform.css', 'gradient-shadow-text.css', 'corner-shape.css', 'focus.css']) {
    const path = resolve(themeRoot, file)
    if (!existsSync(path)) continue
    for (const m of readFileSync(path, 'utf8').matchAll(/^\s*(--dsw-[\w-]+)\s*:/gm)) declared.add(m[1])
  }
  const used = [...new Set([...stylesheet.matchAll(/var\((--dsw-[\w-]+)/g)].map(m => m[1]))]
  const unknown = used.filter(name => !declared.has(name))
  check('every --dsw-* token is declared by the theme', unknown.length === 0, unknown.join(', '))
} else {
  console.log('SKIP  theme token check (no dsh checkout beside this project)')
}

// --- Published manifest contract ----------------------------------------------------
//
// Every `exports` target has to exist. This is not a formality: a `default` that
// names a path the build never writes resolves to a directory or to nothing, and
// the failure only shows up in the consumer that imports it. Three separate targets
// were broken here before this check existed, including the one the Typert contract
// depends on for a consumer to pick up the declaration merge.
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'))
for (const [subpath, target] of Object.entries(manifest.exports)) {
  if (typeof target === 'string') {
    check(`exports["${subpath}"] points at a file`, existsSync(resolve(import.meta.dirname, target)))
    continue
  }
  for (const [condition, value] of Object.entries(target)) {
    check(`exports["${subpath}"].${condition} points at a file`,
      existsSync(resolve(import.meta.dirname, value)), value)
  }
}

// docs/cookbook/adding-a-package.zh.md:27 — no src, no declaration maps, no JS
// maps in the published set.
check('files publishes no source tree', !manifest.files.includes('src/'))
check('files publishes no whole lib/ tree', !manifest.files.includes('lib/'))
check('files publishes no map files', !manifest.files.some(f => f.endsWith('.map')))

// docs/user/develop/basic/publish.zh.md:169 — a git install pulls sources, not
// artifacts, and nothing runs the build unless the author provides `prepare`.
check('a git install can build itself', typeof manifest.scripts?.prepare === 'string',
  String(manifest.scripts?.prepare))

// --- Client bundle contract -------------------------------------------------------
//
// The three-part handoff is the only shape the browser `require` bridge accepts,
// and every external it names has to be a row the shell's frozen module table can
// answer. A bundle that requires a specifier outside that table throws at factory
// execution, which the module system reports as a failed row and nothing else.
const bundlePath = resolve(import.meta.dirname, 'lib/client.js')
check('the client bundle is built', existsSync(bundlePath))
if (existsSync(bundlePath)) {
  const bundle = readFileSync(bundlePath, 'utf8')
  // The output formatter re-indents the banner, so these match the pieces with
  // whitespace collapsed rather than the literal lines tsdown was handed.
  const flat = bundle.replace(/\s+/gu, ' ')
  check('the bundle opens with the module registration',
    flat.startsWith('window.__ModuleLoader__.load({ id: "@audsiui/dsh-minimax-coding-plan", factory: (require) => {'),
    flat.slice(0, 120))
  check('the bundle declares the loader factory',
    flat.includes('factory: (require) => {'))
  check('the bundle hands back its private exports',
    flat.includes('return module.exports; } });'), flat.slice(-90))
  check('the bundle does not minify away its own module bindings',
    flat.includes('var module = { exports: {} };') && flat.includes('var exports = module.exports;'))

  // The platform table this build was told to target. Duplicated from
  // tsdown.config.ts on purpose: the check is worthless if it reads the same
  // list the build read.
  const platform = [
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-runtime/client', '@deepseek-ai/dsh-client-locale/client',
    '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-typert-protocol',
  ]
  const required = [...bundle.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map(match => match[2])
  const external = [...new Set(required.filter(specifier => !specifier.startsWith('.')))]
  check('every external the bundle requires is a platform row',
    external.every(specifier => platform.includes(specifier)),
    external.filter(specifier => !platform.includes(specifier)).join(', '))
  check('the bundle externalises nothing from @deepseek-ai outside the table',
    !external.some(specifier => specifier.startsWith('@deepseek-ai/')
      && !platform.includes(specifier)),
    external.join(', '))

  // The client map has to reach the TSX, or a browser stack frame is a wall of
  // emitted JavaScript. Before the tsc-map chaining this bundle's 24 sources were
  // all lib/client-types/**.
  const mapPath = `${bundlePath}.map`
  check('the client bundle ships a map', existsSync(mapPath))
  if (existsSync(mapPath)) {
    const map = JSON.parse(readFileSync(mapPath, 'utf8'))
    const authored = map.sources.filter(source => /\.(ts|tsx)$/.test(source))
    check('the map reaches the authored sources', authored.length > 0, `${authored.length} ts/tsx of ${map.sources.length}`)
    check('the map carries the source text',
      Array.isArray(map.sourcesContent) && map.sourcesContent.filter(Boolean).length === map.sources.length)
  }
}

// A split chunk is fetched as `./client.<name>.js` by the loader bridge, so a
// chunk that does not carry that name is a request the module system cannot make.
check('no chunk escapes the loader naming convention',
  !existsSync(resolve(import.meta.dirname, 'lib')) ||
  readdirSync(resolve(import.meta.dirname, 'lib')).every(name => !/^chunk-.*\.js$/.test(name)),
  readdirSync(resolve(import.meta.dirname, 'lib')).filter(name => /^chunk-.*\.js$/.test(name)).join(', '))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
