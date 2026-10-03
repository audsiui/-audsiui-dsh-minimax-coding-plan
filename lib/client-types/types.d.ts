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
/** Where the account stands, as the surface needs to describe it. */
export type RemoteAccountStatus = 'signed-out' | 'authorizing' | 'authenticated';
/** Account state for display. Carries no credential material. */
export interface RemoteAccountView {
    readonly status: RemoteAccountStatus;
    /** Device code to type into the verification page, while authorizing. */
    readonly userCode: string | null;
    readonly verificationUri: string | null;
    /** Seconds the device code remains valid, while authorizing. */
    readonly expiresInSec: number | null;
    /** Account id the token endpoint reported, when it reported one. */
    readonly accountId: string | null;
    /** Absolute expiry of the current access token, in epoch milliseconds. */
    readonly expiresAtMs: number | null;
    /** Region whose account origin issued the grant. */
    readonly region: string;
}
/** Which allowance window a figure belongs to. */
export type RemoteQuotaWindowId = 'interval' | 'weekly';
/**
 * The currency a window's allowance is actually drawn in.
 *
 * The service reports a percentage pair on every window and a count triple on
 * some, and the two describe the same window rather than two views of it. Which
 * one is the real allowance is decided once, by the Host, from what the service
 * actually sent — and carried here so the surface draws the number rather than
 * re-deriving the rule. An earlier version left that choice to the surface,
 * which meant the policy lived on one side of the seam and the parser that
 * produced the evidence lived on the other.
 */
export type QuotaMeter = 'count' | 'percent';
/**
 * One metered allowance window, for one model.
 *
 * The service groups its answer by model family — a real account reports
 * `general` and `video` separately — so the model is part of the window's
 * identity, not a decoration on it. There is no label: the surface owns the
 * wording, and a Chinese string in the Host half has no locale to travel with.
 */
export interface RemoteQuotaWindow {
    /** `model_name` the service reported this window under. */
    readonly model: string;
    /** Which window this figure is for. */
    readonly window: RemoteQuotaWindowId;
    /**
     * Allowance as a percentage, **not** bounded by 100 — a real weekly window
     * reported `150%`. The rendered bar bounds the ratio, not this number.
     */
    readonly totalPercent: number;
    /** Consumed share of `totalPercent`. */
    readonly usedPercent: number;
    /** Epoch milliseconds the window resets, when reported. */
    readonly resetAtMs: number | null;
    /** Milliseconds left in the window, as the service counts them. */
    readonly remainsMs: number | null;
    /**
     * Request-count allowance, when the window is metered in requests.
     *
     * `null` is the service's `-1`: the window has no request-count quota and is
     * metered purely as a percentage of {@link totalPercent}. A real account
     * reports `-1` on its `general` entry alongside a live `6% / 150%` weekly
     * allowance, so the two currencies coexist and neither implies the other.
     */
    readonly totalCount: number | null;
    /** Requests consumed from {@link totalCount}, when it is a real count. */
    readonly usedCount: number | null;
    /** Requests left, as the service counts them, when it counts at all. */
    readonly remainsCount: number | null;
    /**
     * The currency to draw this window in.
     *
     * `count` when the service sent a real request-count allowance, `percent`
     * when it sent `-1` for the counts and metered the window as a share of
     * {@link totalPercent}. A real account does both: `general` at 6% / 150% and
     * `video` at 0 / 21 on the same response.
     */
    readonly meter: QuotaMeter;
    /**
     * False when the response carried none of this window's fields.
     *
     * Decided by the percentage fields, which every metered window reports. The
     * service's `*_count` fields are deliberately not consulted: a `-1` there
     * means there is no request-count quota attached, not that the window goes
     * unmetered, and a real account reports `-1` counts alongside a live
     * `6% / 150%` allowance.
     */
    readonly present: boolean;
    /** The service's own window status, verbatim. */
    readonly status: number | null;
    /**
     * Whether the service reports this window as not metered.
     *
     * The service's own status of `3` is the only value with evidence behind it —
     * it is the value MiniMax's client maps to its "unlimited" flag, and a real
     * account reports `1` on every window.
     */
    readonly unlimited: boolean;
}
/** Who is signed in and what they bought. */
export interface RemotePlanView {
    /** Display name the account service reported. */
    readonly accountName: string | null;
    /**
     * Stable account id, or null.
     *
     * The OAuth grant carries none of its own: the access token is an opaque
     * 60-character string rather than a JWT, so there is no claim to read. This
     * is the only place an account id can come from.
     */
    readonly accountId: string | null;
    /** Plan tier name, e.g. `Max`. */
    readonly tier: string | null;
    /** When the plan itself lapses, in epoch milliseconds. */
    readonly planExpiresAtMs: number | null;
    /** Whether the service considers this account to be on a token plan. */
    readonly hasTokenPlan: boolean | null;
    /** The service's own subscription kind, e.g. `token_plan`. */
    readonly subscriptionType: string | null;
    /** Set when the read failed, so the surface can say why the card is thin. */
    readonly error: string | null;
}
/** The whole usage read, or why there is none. */
export interface RemoteQuotaView {
    readonly windows: readonly RemoteQuotaWindow[];
    /** Epoch milliseconds the numbers were fetched at. */
    readonly fetchedAtMs: number;
    /** Set when a grant was rejected, so the surface can offer sign-in again. */
    readonly authExpired: boolean;
    /** Set when the read failed for any other reason. */
    readonly error: string | null;
}
/** Why a sign-in attempt ended without a grant. */
export interface RemoteSignInFailure {
    readonly reason: string;
}
//# sourceMappingURL=types.d.ts.map