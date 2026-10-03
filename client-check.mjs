// Assert the browser bundle's shape, so a bundler change that breaks the
// loader contract fails here rather than in a browser console.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname, 'lib/client.js'), 'utf8')

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
// The footer is a return expression, and minification may prepend other
// assignments to it, so match the shape rather than a fixed prefix.
check('closes by handing module.exports back',
  /\breturn[\w,=.;\s]*\.exports\}\}\);/.test(source.trimEnd()))

// The platform modules this build actually imports at runtime. The client only
// reaches the shell through the module loader, so anything it pulls from
// `@deepseek-ai/*` has to arrive through `require`: a bundled copy of the slot
// registry would be a *different* registry than the one rendering the page, and
// entries would register into a table nothing reads.
for (const mod of ['react', 'react/jsx-runtime']) {
  check(`${mod} is resolved through require, not bundled`,
    new RegExp(`\\w+\\("${mod.replace('/', '\\/')}"\\)`).test(source))
}
check('no zod is inlined into the browser bundle',
  !source.includes('zod/v4/core') && !source.includes('getEnumValues'))

// The surface must actually be registered, or the entry loads and does nothing.
check('mounts the generated Remote contribution', /\$mount\(/.test(source))
check('registers the sign-in / sign-out action', source.includes('settings.action'))
check('registers the usage section', source.includes('settings.section'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
