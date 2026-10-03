// Remove the build output.
//
// The four tsdown configurations must not each clean: the first one runs
// after the two `tsc` passes have already emitted into lib/, so a per-config
// clean would delete the very JavaScript those passes produced and every entry
// would resolve to nothing. Cleaning once, before tsc, is the only ordering
// that both starts from a clean tree and leaves tsc's output in place.
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

await rm(resolve(import.meta.dirname, '..', 'lib'), { recursive: true, force: true })
