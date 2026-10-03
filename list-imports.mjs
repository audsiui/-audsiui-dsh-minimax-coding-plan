// List a package's bare import specifiers, so its undeclared runtime needs can
// be installed in one pass instead of discovered one error at a time.
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const target = resolve(import.meta.dirname, process.argv[2] ?? '.')
const seen = new Set()
const files = []

const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.js')) files.push(path)
  }
}
walk(join(target, 'lib'))

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/gu)) {
    const spec = match[1]
    if (spec === undefined || spec.startsWith('.') || spec.startsWith('node:')) continue
    // `@scope/name/sub` -> `@scope/name`
    const parts = spec.split('/')
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    seen.add(name)
  }
}
console.log([...seen].sort().join('\n'))
