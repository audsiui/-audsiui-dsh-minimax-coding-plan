import { defineConfig } from 'tsdown'

/**
 * Self-contained build, also used as the `prepare` script.
 *
 * `prepare` runs after pnpm clones a git dependency, in an environment with no
 * monorepo checkout beside it, so this config must not depend on project
 * references or on any sibling workspace package. It transpiles `src/` straight
 * to the published entry and performs no type checking — `npm run typecheck` is
 * the gate for types.
 *
 * Every `@deepseek-ai/*` dependency stays external. These are the host's
 * singletons: the running harness owns one instance of each, and a second copy
 * inside this bundle would break identity. That matters most for
 * `@deepseek-ai/schemastery`, whose schema objects are compared by instance —
 * a bundled copy would produce schemas the host's loader cannot recognise.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: true,
  // `package.json#main` names `lib/index.js`; without this the ESM-only build
  // emits `index.mjs` and the loader's entry lookup misses.
  fixedExtension: false,
  external: [/^@deepseek-ai\//],
})
