// Copy the browser half's non-JavaScript assets next to its emitted JavaScript.
//
// `tsc` resolves and type-checks the stylesheet import but does not copy it, and
// tsdown bundles from the emitted tree rather than from source, so the compiled
// entry would import a file that is not there. Copying the whole client
// directory's stylesheets keeps the two in step without a second path in the
// bundler config.
import { cp, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const from = resolve(import.meta.dirname, '..', 'src', 'client')
const to = resolve(import.meta.dirname, '..', 'lib', 'client-types', 'client')

await mkdir(to, { recursive: true })
let copied = 0
for (const entry of await readdir(from, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.css')) {
    await cp(join(from, entry.name), join(to, entry.name))
    copied += 1
  }
}
console.log(`copied ${copied} stylesheet(s) into lib/client-types/client`)
