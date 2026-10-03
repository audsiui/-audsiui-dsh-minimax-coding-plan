import { type RegionEndpoints } from './constants.ts';
/** One in-flight device authorization, including the PKCE secret to present later. */
export interface DeviceAuthorization {
    /** Opaque code polled against the token endpoint. */
    readonly deviceCode: string;
    /** Short code the operator types into the verification page. */
    readonly userCode: string;
    /** Page the operator opens. */
    readonly verificationUri: string;
    /** Page with the user code already embedded, when the server offers one. */
    readonly verificationUriComplete: string | undefined;
    /** Lifetime of this authorization in seconds. */
    readonly expiresInSec: number;
    /** Poll cadence the server asked for, in seconds. */
    readonly intervalSec: number;
    /** PKCE verifier; presented to the token endpoint, never leaves the host. */
    readonly codeVerifier: string;
}
/** One successful token response, already normalized for storage. */
export interface TokenGrant {
    readonly accessToken: string;
    /**
     * Absent when the server issued none.
     *
     * RFC 8628 §3.5 makes the refresh token *optional* in a device-flow token
     * response, so requiring one throws away a working access token over a field
     * the protocol says may not be there. Without it the grant is still usable
     * until the access token expires; only the refresh path is unavailable.
     */
    readonly refreshToken: string | undefined;
    /** Absolute access-token expiry. */
    readonly expiresAtMs: number;
    /** Scopes granted; the provider requires {@link OAUTH_SCOPE} to be present. */
    readonly scopes: readonly string[];
    /** Stable account id read from the access token, when present. */
    readonly accountId: string | undefined;
    /** Stable user id read from the access token, when present. */
    readonly subject: string | undefined;
}
/** A protocol-level rejection carrying the server's own error code. */
export declare class OAuthProtocolError extends Error {
    /** Server-supplied `error` value, or a client-side classification. */
    readonly code: string;
    /** HTTP status, when the failure came from a response. */
    readonly httpStatus: number | undefined;
    /** @param code - server error code. @param message - human-readable detail. @param httpStatus - response status. */
    constructor(code: string, message?: string, httpStatus?: number);
}
/** Injectable collaborators so tests need no network and no wall clock. */
export interface OAuthClientOptions {
    /** Request implementation; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
    /** Delay implementation used between polls. */
    readonly sleep?: (ms: number) => Promise<void>;
    /** Clock used for expiry math. */
    readonly now?: () => number;
}
/**
 * Start a device authorization and return everything needed to finish it.
 * @param endpoints - region origins.
 * @param options - injectable collaborators.
 * @param signal - cancels the request.
 * @returns the pending authorization, including the PKCE verifier.
 */
export declare function requestDeviceAuthorization(endpoints: RegionEndpoints, options?: OAuthClientOptions, signal?: AbortSignal): Promise<DeviceAuthorization>;
/**
 * Poll until the operator approves, the grant is denied, or it expires.
 *
 * The server signals a not-yet-approved attempt with HTTP 400 plus
 * `authorization_pending` (RFC 8628 §3.5), which is what the account origin
 * actually does — verified against `account.minimax.cn`, where the first poll
 * answers `400 {"error":"authorization_pending"}` and an over-eager second one
 * answers `400 {"error":"slow_down"}`. A `200` body carrying a `status` field is
 * also accepted, because nothing in the protocol forbids a server from using it
 * and rejecting one would be a guess.
 *
 * The first poll waits out the server's advertised `interval` rather than firing
 * immediately: polling inside the window earns a `slow_down`, which costs a
 * five-second penalty on top of the wait.
 *
 * @param endpoints - region origins.
 * @param authorization - pending authorization from {@link requestDeviceAuthorization}.
 * @param options - injectable collaborators.
 * @param signal - stops polling.
 * @returns the granted token set.
 */
export declare function pollDeviceToken(endpoints: RegionEndpoints, authorization: DeviceAuthorization, options?: OAuthClientOptions, signal?: AbortSignal): Promise<TokenGrant>;
/**
 * Exchange a refresh token for a new access token.
 * @param endpoints - region origins.
 * @param refreshToken - stored refresh token.
 * @param options - injectable collaborators.
 * @param signal - cancels the request.
 * @returns the granted token set; the server may or may not rotate the refresh token.
 */
export declare function refreshAccessToken(endpoints: RegionEndpoints, refreshToken: string, options?: OAuthClientOptions, signal?: AbortSignal): Promise<TokenGrant>;
/**
 * Revoke a refresh token, best-effort.
 *
 * The production account origin answers `404` here — the revocation route is
 * referenced by MiniMax's own client but is not deployed — so a missing
 * endpoint is treated as "already unusable" and sign-out still completes. Any
 * other failure propagates for the caller to log.
 *
 * @param endpoints - region origins.
 * @param refreshToken - stored refresh token.
 * @param options - injectable collaborators.
 * @param signal - cancels the request.
 */
export declare function revokeRefreshToken(endpoints: RegionEndpoints, refreshToken: string, options?: OAuthClientOptions, signal?: AbortSignal): Promise<void>;
//# sourceMappingURL=oauth.d.ts.map