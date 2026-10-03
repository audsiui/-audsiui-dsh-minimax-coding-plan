// Copy the browser half's stylesheets, and the generated Typert declarations,
// to the places the manifest's `exports` conditions name.
//
// Two independent reasons this exists:
//
//  1. `tsc` resolves and type-checks a stylesheet import but does not copy it,
//     and tsdown bundles from the emitted tree rather than from source, so the
//     compiled entry would import a file that is not there.
//  2. `build/clean.mjs` empties `lib/` before every build, and the two Typert
//     `types` conditions point at `lib/typert.host.d.ts` and
//     `lib/typert.remote-client.d.ts`. Those files are the generator's own
//     output; without this step `exports` names files that do not exist and a
//     consumer importing the `/remote` subpath gets no declaration merge
//     (`docs/api-gateway.zh.md:78`).
//
// Both outputs are committed under `src/`, so a git install builds nothing.
import { cp, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const STYLESHEETS = {
  from: resolve(root, 'src', 'client'),
  to: resolve(root, 'lib', 'client-types', 'client'),
}
const DECLARATIONS = {
  from: resolve(root, 'src', 'generated'),
  to: resolve(root, 'lib'),
  names: ['typert.host.d.ts', 'typert.remote-client.d.ts', 'typert.remote-client.d.ts.map'],
}

await mkdir(STYLESHEETS.to, { recursive: true })
let stylesheets = 0
for (const entry of await readdir(STYLESHEETS.from, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.css')) {
    await cp(join(STYLESHEETS.from, entry.name), join(STYLESHEETS.to, entry.name))
    stylesheets += 1
  }
}

let declarations = 0
for (const name of DECLARATIONS.names) {
  await cp(join(DECLARATIONS.from, name), join(DECLARATIONS.to, name))
  declarations += 1
}

console.log(`copied ${stylesheets} stylesheet(s) and ${declarations} Typert declaration(s) into lib/`)
