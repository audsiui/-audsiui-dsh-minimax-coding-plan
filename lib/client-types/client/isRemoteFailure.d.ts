/**
 * Telling a Remote failure apart from a local defect.
 *
 * `docs/cookbook/adding-a-remote-api.zh.md:109` names `isRemoteFailure` from
 * `@deepseek-ai/dsh-api-gateway/client` for this job. That import is not usable
 * from here, and the two rules that block it are both explicit:
 *
 * 1. `docs/subsystems/web-client.zh.md:91` — a feature plugin may share
 *    declarations with another feature plugin through `import type`, but must
 *    not runtime-import its values, and must not add a `dsh.client.external`
 *    row merely to get around that. The Gateway is a feature plugin: its own
 *    manifest carries a `dsh.client.inject` block and mounts with
 *    `immediately: true`.
 * 2. The `clientBundle` purity gate (`packages/client/tsdown.client.ts:533-544`)
 *    throws on any `@deepseek-ai/*` value import that is neither a frozen
 *    module-table row, an `INLINE_SAFE` wire layer, nor a generated `/remote`
 *    contribution. `@deepseek-ai/dsh-api-gateway` is none of the three, so the
 *    build would fail on the import this file is replacing — which is the gate
 *    working, not the gate being wrong.
 *
 * The lower alternative, `remoteErrorOf` from `@deepseek-ai/dsh-typert-protocol`,
 * is ruled out by its own documentation: "Mechanism-internal: the Gateway and
 * test assertions use it; business code receives typed failures and never needs
 * it" (`lib/types/remote-error.d.ts:24-26`).
 *
 * So the marker test is restated here, against the type-only import the package
 * boundary rule does permit. The predicate below is the same three lines as
 * `dsh-typert-protocol/lib/index.js:36-38`, and it is structural on purpose: this
 * bundle runs inside `__ModuleLoader__` as its own factory, so the caught
 * `RemoteError` is a different class object than any copy imported here, and an
 * `instanceof` test would answer false for a genuine Host failure.
 */
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol';
/**
 * @param value - a caught value.
 * @returns true when the value carries a Remote failure's marker.
 */
export declare function isRemoteFailure(value: unknown): value is RemoteFailure;
//# sourceMappingURL=isRemoteFailure.d.ts.map