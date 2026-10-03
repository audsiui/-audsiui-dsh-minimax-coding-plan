/**
 * The vocabulary shared by the Host service and the browser half.
 *
 * Every shape here crosses `ctx.remote`, so the Typert generator derives a
 * strict codec from it. That constrains the vocabulary: plain records of
 * JSON-representable values, and `null` rather than `undefined` for "absent",
 * because an optional property has no single unambiguous wire encoding while
 * an explicit null does. The browser half never sees a Cordis type, a class,
 * or a token.
 *
 * There is deliberately no second set of "internal" shapes alongside these. The
 * Host's readers parse straight into them, because a parallel model differing
 * only in how it spells absence buys nothing and costs a projection function per
 * field per read: an earlier version kept `QuotaWindow` and `PlanSnapshot`
 * alongside `RemoteQuotaWindow` and `RemotePlanView`, and every field added
 * since had to be written three times and translated by hand. One vocabulary,
 * parsed once, drawn directly.
 */
export {};
//# sourceMappingURL=types.js.map