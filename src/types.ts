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
export type RemoteAccountStatus = 'signed-out' | 'authorizing' | 'authenticated'

/** Account state for display. Carries no credential material. */
export interface RemoteAccountView {
  readonly status: RemoteAccountStatus
  /** Device code to type into the verification page, while authorizing. */
  readonly userCode: string | null
  readonly verificationUri: string | null
  /** Seconds the device code remains valid, while authorizing. */
  readonly expiresInSec: number | null
  /** Account id the token endpoint reported, when it reported one. */
  readonly accountId: string | null
  /** Absolute expiry of the current access token, in epoch milliseconds. */
  readonly expiresAtMs: number | null
  /** Region whose account origin issued the grant. */
  readonly region: string
}

/** One metered allowance window. */
export interface RemoteQuotaWindow {
  /** Stable window id: `interval` or `weekly`. */
  readonly id: string
  /** Human label for the surface. */
  readonly label: string
  /** Allowance as a percentage. */
  readonly totalPercent: number
  /** Consumed share of `totalPercent`. */
  readonly usedPercent: number
  /** Epoch milliseconds the window resets, when reported. */
  readonly resetAtMs: number | null
  /** The plan does not actually cap this window. */
  readonly unlimited: boolean
  /** False when the response carried none of this window's fields. */
  readonly present: boolean
}

/** The whole usage read, or why there is none. */
export interface RemoteQuotaView {
  readonly windows: readonly RemoteQuotaWindow[]
  readonly planLabel: string | null
  /** Epoch milliseconds the numbers were fetched at. */
  readonly fetchedAtMs: number
  /** Set when a grant was rejected, so the surface can offer sign-in again. */
  readonly authExpired: boolean
  /** Set when the read failed for any other reason. */
  readonly error: string | null
}

/** Why a sign-in attempt ended without a grant. */
export interface RemoteSignInFailure {
  readonly reason: string
}
