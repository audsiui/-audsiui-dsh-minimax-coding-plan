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
 * tsdown inlines these into the bundle and injects them at materialisation. The
 * module exports **nothing**: the global loader calls `styleInjectionModule`
 * without a class map, and that helper emits a bare `export {};` in that case
 * (`packages/client/tsdown.client.ts:54, 586-600`).
 *
 * A default export was declared here once, and it type-checked — while resolving
 * to `undefined` at runtime, because no loader in this build ever produced one.
 * A side-effect import has no binding to take, so none is offered.
 */
declare module '*.css' {
  export {}
}
