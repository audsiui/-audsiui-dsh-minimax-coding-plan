// Report every `@deepseek-ai/*` package that the installed dsh tree imports but
// that Node cannot resolve from this project. dsh-credentials-local is the usual
// offender: it imports several platform packages it never declares, so a plain
// `npm install` prunes them and the wiring checks fail on the next run.
//
// Usage: node build/find-missing-dsh-deps.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { builtinModules } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const modules = join(root, 'node_modules')

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue
    out.push(join(dir, entry.name))
  }
  return out
}

const missing = new Map()
for (const scope of readdirSync(modules)) {
  if (!scope.startsWith('@')) continue
  for (const name of readdirSync(join(modules, scope))) {
    const pkgRoot = join(modules, scope, name)
    try {
      if (!statSync(pkgRoot).isDirectory()) continue
    } catch { continue }
    const lib = join(pkgRoot, 'lib')
    if (!existsSync(lib)) continue
    for (const file of walk(lib)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/from\s*["'](@deepseek-ai\/[^"']+)["']/g)) {
        const spec = match[1]
        if (new Set(builtinModules).has(spec)) continue
        // A subpath of an installed package is not a missing package.
        const [scope, name] = spec.split('/')
        if (existsSync(join(modules, scope, name, 'package.json'))) continue
        try {
          readFileSync(join(modules, spec, 'package.json'))
        } catch {
          if (!missing.has(spec)) missing.set(spec, new Set())
          missing.get(spec).add(`${scope}/${name}`)
        }
      }
    }
  }
}

if (missing.size === 0) {
  console.log('no unresolved @deepseek-ai/* imports')
} else {
  for (const [spec, importers] of [...missing].sort()) {
    console.log(`${spec}  <-  ${[...importers].join(', ')}`)
  }
  console.log(`\n${missing.size} package(s) to declare`)
}
