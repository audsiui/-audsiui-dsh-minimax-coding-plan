/**
 * Side-effect stylesheet imports.
 *
 * tsdown inlines these into the bundle and injects them at materialisation; the
 * compiler only needs to know the specifier resolves.
 */
declare module '*.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
