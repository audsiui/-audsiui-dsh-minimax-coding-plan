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
     * False when the service's counts were `-1`, its way of saying the plan does
     * not meter this window. The percentages are still present and are advisory.
     */
    readonly metered: boolean;
    /** The service's own window status, verbatim. */
    readonly status: number | null;
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