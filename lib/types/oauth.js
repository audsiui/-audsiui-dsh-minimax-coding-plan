/**
 * MiniMax OAuth 2.0 device-authorization client (RFC 8628 + PKCE).
 *
 * Deliberately free of harness types: the wire contract is testable on its
 * own, and the provider layer stays a thin adapter over it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_POLL_INTERVAL_SEC, DEVICE_GRANT_TYPE, OAUTH_AUDIENCE, OAUTH_CLIENT_ID, OAUTH_SCOPE, } from "./constants.js";
/** A protocol-level rejection carrying the server's own error code. */
export class OAuthProtocolError extends Error {
    /** Server-supplied `error` value, or a client-side classification. */
    code;
    /** HTTP status, when the failure came from a response. */
    httpStatus;
    /** @param code - server error code. @param message - human-readable detail. @param httpStatus - response status. */
    constructor(code, message, httpStatus) {
        super(message ?? `MiniMax OAuth rejected the request (${code}${httpStatus ? `, HTTP ${httpStatus}` : ''}).`);
        this.name = 'OAuthProtocolError';
        this.code = code;
        this.httpStatus = httpStatus;
    }
}
/** One form POST against the account origin, with OAuth error extraction. */
async function postForm(endpoints, path, values, options, signal, post) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${endpoints.accountOrigin}${path}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(values),
        ...signal ? { signal } : {},
    });
    if (post?.tolerateMissing && (response.status === 404 || response.status === 405)) {
        return { ok: true, status: response.status, body: {} };
    }
    const body = asRecord(await response.json().catch(() => undefined));
    if (!body)
        throw new OAuthProtocolError('invalid_json_response', undefined, response.status);
    const error = readString(body, 'error');
    const description = readString(body, 'error_description');
    return {
        ok: response.ok && !error,
        status: response.status,
        body,
        ...error === undefined ? {} : { error },
        ...description === undefined ? {} : { description },
    };
}
/**
 * Turn a rejected POST into a protocol error, keeping the server's own wording.
 * @param result - the rejected response.
 * @param fallbackCode - the code to use when the server sent none.
 * @returns the error to throw.
 */
function reject(result, fallbackCode) {
    return new OAuthProtocolError(result.error ?? fallbackCode, result.description, result.status);
}
/**
 * Start a device authorization and return everything needed to finish it.
 * @param endpoints - region origins.
 * @param options - injectable collaborators.
 * @param signal - cancels the request.
 * @returns the pending authorization, including the PKCE verifier.
 */
export async function requestDeviceAuthorization(endpoints, options = {}, signal) {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
    const result = await postForm(endpoints, '/oauth2/device/code', {
        client_id: OAUTH_CLIENT_ID,
        scope: OAUTH_SCOPE,
        audience: OAUTH_AUDIENCE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    }, options, signal);
    if (!result.ok)
        throw reject(result, 'device_authorization_failed');
    const deviceCode = readString(result.body, 'device_code');
    const userCode = readString(result.body, 'user_code');
    const verificationUri = readString(result.body, 'verification_uri') ?? readString(result.body, 'verification_url');
    const expiresInSec = readPositiveNumber(result.body, 'expires_in');
    if (!deviceCode || !userCode || !verificationUri || !expiresInSec) {
        throw new OAuthProtocolError('invalid_device_authorization_response', undefined, result.status);
    }
    return {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete: readString(result.body, 'verification_uri_complete'),
        expiresInSec,
        intervalSec: readPositiveNumber(result.body, 'interval') ?? DEFAULT_POLL_INTERVAL_SEC,
        codeVerifier,
        // Stamped here, immediately after the response lands, rather than in
        // `pollDeviceToken` — every microtask between the two belongs to the
        // code's own lifetime.
        issuedAtMs: (options.now ?? Date.now)(),
    };
}
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
export async function pollDeviceToken(endpoints, authorization, options = {}, signal) {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    // RFC 8628 §3.2: `expires_in` bounds the device code from the moment the
    // authorization response was produced, not from the first poll. Anchoring to
    // the first poll would add every microtask spent getting here — state
    // assignment, a log line, a browser launch — to the window.
    const deadline = authorization.issuedAtMs + authorization.expiresInSec * 1_000;
    let intervalMs = authorization.intervalSec * 1_000;
    while (true) {
        signal?.throwIfAborted();
        // Respect the advertised cadence from the very first poll, not just between
        // them: the account origin answers a poll issued inside that window with
        // `slow_down`, which then costs an extra five seconds on every attempt.
        await sleep(intervalMs);
        // Re-check *after* the wait, never before it. A sleep that carries the
        // attempt past its life has to end the loop here; checking at the top would
        // admit one more poll against a code the server has already expired, and
        // turn a local, correct `expired_token` into a server verdict about a
        // request that was never entitled to an answer.
        if (now() >= deadline)
            break;
        const result = await postForm(endpoints, '/oauth2/token', {
            grant_type: DEVICE_GRANT_TYPE,
            device_code: authorization.deviceCode,
            client_id: OAUTH_CLIENT_ID,
            code_verifier: authorization.codeVerifier,
        }, options, signal);
        const status = readString(result.body, 'status');
        if (result.ok) {
            // The wait already happened at the top of the loop, so a `continue` here
            // costs exactly one interval — not two.
            if (status === 'pending')
                continue;
            if (status === 'slow_down') {
                intervalMs += 5_000;
                continue;
            }
            if (status === 'denied' || status === 'access_denied')
                throw new OAuthProtocolError('access_denied');
            if (status === 'expired' || status === 'expired_token')
                throw new OAuthProtocolError('expired_token');
            return parseTokenGrant(result.body, now());
        }
        if (result.error === 'authorization_pending' || result.error === 'slow_down') {
            if (result.error === 'slow_down')
                intervalMs += 5_000;
            continue;
        }
        throw reject(result, 'device_authorization_failed');
    }
    throw new OAuthProtocolError('expired_token', 'The MiniMax device authorization expired before it was approved.');
}
/**
 * Exchange a refresh token for a new access token.
 * @param endpoints - region origins.
 * @param refreshToken - stored refresh token.
 * @param options - injectable collaborators.
 * @param signal - cancels the request.
 * @returns the granted token set; the server may or may not rotate the refresh token.
 */
export async function refreshAccessToken(endpoints, refreshToken, options = {}, signal) {
    const result = await postForm(endpoints, '/oauth2/token', {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
        scope: OAUTH_SCOPE,
        audience: OAUTH_AUDIENCE,
    }, options, signal);
    if (!result.ok)
        throw reject(result, 'token_refresh_failed');
    return parseTokenGrant(result.body, (options.now ?? Date.now)(), refreshToken);
}
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
export async function revokeRefreshToken(endpoints, refreshToken, options = {}, signal) {
    const result = await postForm(endpoints, '/oauth2/revoke', {
        token: refreshToken,
        token_type_hint: 'refresh_token',
        client_id: OAUTH_CLIENT_ID,
    }, options, signal, { tolerateMissing: true });
    if (!result.ok)
        throw reject(result, 'oauth_request_failed');
}
/**
 * Validate one token response and project it onto {@link TokenGrant}.
 *
 * Every rejection below is a condition this client *assumes* the server holds
 * to, and none of them has been observed on a real success response — an
 * assumption that silently discards a valid grant is indistinguishable, from
 * the surface, from a failed sign-in. So a rejection names the conditions that
 * failed and the field names the response actually carried, which is enough to
 * tell a malformed grant from a wrong assumption without logging a single
 * secret. Field *names* only: no value from this object is ever interpolated.
 */
function parseTokenGrant(body, nowMs, previousRefreshToken) {
    const accessToken = readString(body, 'access_token');
    const refreshToken = readString(body, 'refresh_token') ?? previousRefreshToken;
    const tokenType = readString(body, 'token_type');
    const expiresInSec = readPositiveNumber(body, 'expires_in');
    const claims = accessToken ? decodeJwtPayload(accessToken) : undefined;
    // RFC 6749 §5.1: when the token response omits `scope`, it is identical to the
    // scope the client requested. Requiring the field to be echoed would reject
    // every conformant server that takes that shortcut.
    const declared = parseScopes(body.scope ?? claims?.scope ?? claims?.scp);
    const scopes = declared.length > 0 ? declared : [OAUTH_SCOPE];
    const failed = (reason) => new OAuthProtocolError('invalid_token_response', `MiniMax returned a token this client rejected: ${reason}. `
        + `Response carried fields: ${Object.keys(body).sort().join(', ') || '(none)'}. `
        + 'The value checks above are this client\'s assumptions, not a documented contract.');
    // Each check throws directly rather than accumulating into a list, so the
    // narrowed types carry through to the return below.
    if (!accessToken)
        throw failed('access_token missing');
    if (tokenType?.toLowerCase() !== 'bearer') {
        throw failed(`token_type is ${tokenType === undefined ? 'absent' : JSON.stringify(tokenType)}`);
    }
    if (expiresInSec === undefined)
        throw failed('expires_in missing or not positive');
    if (!scopes.includes(OAUTH_SCOPE)) {
        throw failed(`scope ${JSON.stringify(scopes)} does not include ${JSON.stringify(OAUTH_SCOPE)}`);
    }
    return {
        accessToken,
        refreshToken,
        expiresAtMs: nowMs + expiresInSec * 1_000,
        scopes,
        accountId: readString(claims, 'account_id'),
        subject: readString(claims, 'sub'),
    };
}
/** Decode a JWT payload without verifying it; the transport is HTTPS-authenticated. */
function decodeJwtPayload(token) {
    const segments = token.split('.');
    if (segments.length !== 3 || !segments[1])
        return undefined;
    try {
        return asRecord(JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')));
    }
    catch {
        return undefined;
    }
}
/** Normalize a scope claim that may arrive as a string or an array. */
function parseScopes(value) {
    if (typeof value === 'string')
        return value.split(/\s+/u).filter(Boolean);
    if (Array.isArray(value) && value.every(scope => typeof scope === 'string')) {
        return value.filter((scope) => typeof scope === 'string');
    }
    return [];
}
/** Narrow a JSON value to an object with readable string keys. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asRecord(value) {
    return isRecord(value) ? value : undefined;
}
function readString(value, key) {
    const record = asRecord(value);
    const candidate = record?.[key];
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}
function readPositiveNumber(value, key) {
    const record = asRecord(value);
    const candidate = record?.[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
        ? candidate
        : undefined;
}
//# sourceMappingURL=oauth.js.map