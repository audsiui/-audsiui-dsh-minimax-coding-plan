/**
 * The wire contract between the Host service and the browser half.
 *
 * Every shape here crosses `ctx.remote`, so the Typert generator derives a
 * strict codec from it. That constrains the vocabulary: plain records of
 * JSON-representable values, and `null` rather than `undefined` for "absent",
 * because an optional property has no single unambiguous wire encoding while
 * an explicit null does. The Host projects into these; the browser half never
 * sees a Cordis type, a class, or a token.
 */
export {};
//# sourceMappingURL=types.js.map