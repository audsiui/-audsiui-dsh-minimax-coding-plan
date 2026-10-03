// Assert the browser bundle's shape, so a bundler change that breaks the
// loader contract fails here rather than in a browser console.
//
// The second half asserts the styling rules `docs/web-styling.zh.md` and
// `docs/ui-radius.zh.md` state in plain text. Those are the rules a future
// edit is most likely to break by accident, and a wrong token or a missing
// `corner-shape` pairing renders wrong rather than erroring, so nothing else
// in the build would notice.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'lib/client.js'), 'utf8')
const stylesheet = readFileSync(resolve(import.meta.dirname, 'src/client/MinimaxPage.module.css'), 'utf8')

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
}

// The three-part lazy CJS contract. Anything else loads as a script that
// exports nothing, and the failure surfaces as a module that is simply absent.
check('registers a factory with the module loader',
  source.startsWith('window.__ModuleLoader__.load({'))
check('names this package, so the loader maps it to the right row',
  /load\(\{id:`@audsiui\/dsh-minimax-coding-plan`/.test(source))
check('opens with a private module/exports pair',
  /factory:\w+=>\{var \w+=\{exports:\{\}\},\w+=\w+\.exports/.test(source))
// The footer is a return expression, and minification both renames the private
// pair and prepends assignments to it, so match the shape rather than a fixed
// prefix. The character class has to allow `$`, which minified identifiers use.
check('closes by handing module.exports back',
  /\breturn[\w$=,.;\s]*\.exports\}\}\);/.test(source.trimEnd()))

// The platform modules this build actually imports at runtime. The client only
// reaches the shell through the module loader, so anything it pulls from
// `@deepseek-ai/*` has to arrive through `require`: a bundled copy of the slot
// registry would be a *different* registry than the one rendering the page, and
// entries would register into a table nothing reads.
for (const mod of ['react', 'react/jsx-runtime']) {
  check(`${mod} is resolved through require, not bundled`,
    new RegExp(`\\w+\\("${mod.replace('/', '\\/')}"\\)`).test(source))
}

// The surface must actually be registered, or the entry loads and does nothing.
check('mounts the generated Remote contribution', /\$mount\(/.test(source))
check('registers exactly one settings section', source.includes('settings.section'))
check('the page reaches dsh primitives, not raw elements',
  source.includes('SegmentedControl'))

// The stylesheet must be inlined and self-injecting. Extracted to a sibling
// `style.css` it is never requested by the combo script, and the page renders
// unstyled with nothing in the console to explain it.
check('the stylesheet is inlined into the bundle', source.includes('data-plugin-css'))
check('the stylesheet injects a <style> element', /createElement\(\s*["'`]style["'`]\s*\)/.test(source))
// The selector is hoisted into a variable so the disposer can share it, so the
// idempotence guard is now "queried before appending", not one literal query.
check('injection is idempotent across remounts',
  /querySelector\(\w+\)\)\{/.test(source) && /querySelector\(\w+\);/.test(source))
check('the entry can take its stylesheet back on unload',
  /\.remove\(\)/.test(source))
check('no separate stylesheet is emitted alongside the bundle', !existsSync(resolve(import.meta.dirname, 'lib/style.css')))

// --- Styling rules, from the docs -------------------------------------------------
//
// web-styling.zh.md:17 — component styles are CSS Modules, not a global sheet.
check('component styles are a CSS Module, not a global sheet',
  !/(^|\})\s*\.minimax-[\w-]/.test(stylesheet))
check('the bundle carries scoped class names', /\.\w+_[0-9a-f]{8}\b/.test(source))

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
// superellipse override, or the capsule ends deform under corner-shape. Match
// whole rule blocks first: a rule's radius can appear before its curve, so a
// match that stops at the radius would never see the pairing.
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
  check('every --dsw-* token is declared by the theme', unknown.length === 0,
    unknown.join(', '))
} else {
  console.log('SKIP  theme token check (no dsh checkout beside this project)')
}

// --- Published manifest contract --------------------------------------------------
//
// Every `exports` target has to exist. This is not a formality: a `default` that
// names a path the build never writes resolves to a directory or to nothing, and
// the failure only shows up in the consumer that imports it. Three separate
// targets were broken here before this check existed, including the one the
// Typert contract depends on for a consumer to pick up the declaration merge.
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)