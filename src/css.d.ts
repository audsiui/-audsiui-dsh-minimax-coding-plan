/**
 * Stylesheet module shapes.
 *
 * A `.module.css` specifier resolves to the component's own scoped class map
 * plus the disposer for the `<style>` tag its bundle injected. The bundler
 * plugin in `tsdown.config.ts` is what actually produces both; the compiler
 * only needs to know the shape.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  /** Remove the `<style>` tag this stylesheet injected, if it is still present. */
  export function disposeStylesheet(): void
  export default classes
}

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
