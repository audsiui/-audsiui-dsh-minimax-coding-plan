/**
 * Stylesheet module shapes.
 *
 * A `.module.css` specifier resolves to the component's own scoped class map.
 * The bundler plugin in `tsdown.config.ts` — a restatement of the `clientBundle`
 * preset in `packages/client/tsdown.client.ts` — is what actually produces it;
 * the compiler only needs to know the shape. The injected `<style>` carries no
 * disposer here: the client module system reclaims a module's own styles
 * through the `data-plugin` / `data-plugin-css` dataset keys the injector writes.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
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
