/**
 * MiniMax OAuth 2.0 device-authorization client (RFC 8628 + PKCE).
 *
 * Deliberately free of harness types: the wire contract is testable on its
 * own, and the provider layer stays a thin adapter over it.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  DEFAULT_POLL_INTERVAL_SEC,
  DEVICE_GRANT_TYPE,
  OAUTH_AUDIENCE,
  OAUTH_CLIENT_ID,
  OAUTH_SCOPE,
  type RegionEndpoints,
} from './constants.ts'

/** One in-flight device authorization, including the PKCE secret to present later. */
export interface DeviceAuthorization {
  /** Opaque code polled against the token endpoint. */
  readonly deviceCode: string
  /** Short code the operator types into the verification page. */
  readonly userCode: string
  /** Page the operator opens. */
  readonly verificationUri: string
  /** Page with the user code already embedded, when the server offers one. */
  readonly verificationUriComplete: string | undefined
  /** Lifetime of this authorization in seconds. */
  readonly expiresInSec: number
  /** Poll cadence the server asked for, in seconds. */
  readonly intervalSec: number
  /** PKCE verifier; presented to the token endpoint, never leaves the host. */
  readonly codeVerifier: string
}

/** One successful token response, already normalized for storage. */
export interface TokenGrant {
  readonly accessToken: string
  readonly refreshToken: string
  /** Absolute access-token expiry. */
  readonly expiresAtMs: number
  /** Scopes granted; the provider requires {@link OAUTH_SCOPE} to be present. */
  readonly scopes: readonly string[]
  /** Stable account id read from the access token, when present. */
  readonly accountId: string | undefined
  /** Stable user id read from the access token, when present. */
  readonly subject: string | undefined
}

/** A protocol-level rejection carrying the server's own error code. */
export class OAuthProtocolError extends Error {
  /** Server-supplied `error` value, or a client-side classification. */
  readonly code: string
  /** HTTP status, when the failure came from a response. */
  readonly httpStatus: number | undefined

  /** @param code - server error code. @param message - human-readable detail. @param httpStatus - response status. */
  constructor(code: string, message?: string, httpStatus?: number) {
    super(message ?? `MiniMax OAuth rejected the request (${code}${httpStatus ? `, HTTP ${httpStatus}` : ''}).`)
    this.name = 'OAuthProtocolError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

/** Injectable collaborators so tests need no network and no wall clock. */
export interface OAuthClientOptions {
  /** Request implementation; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Delay implementation used between polls. */
  readonly sleep?: (ms: number) => Promise<void>
  /** Clock used for expiry math. */
  readonly now?: () => number
}

interface PostResult {
  readonly ok: boolean
  readonly status: number
  readonly body: Record<string, unknown>
  /** Server-supplied `error`, absent when the response was a success. */
  readonly error?: string
}

/** Extra per-call behaviour for {@link postForm}. */
interface PostOptions {
  /**
   * Treat `404`/`405` as success with an empty body. The production account
   * origin does not deploy the revocation route, so a missing endpoint is the
   * expected steady state there rather than a failure.
   */
  readonly tolerateMissing?: boolean
}

/** One form POST against the account origin, with OAuth error extraction. */
async function postForm(
  endpoints: RegionEndpoints,
  path: string,
  values: Record<string, string>,
  options: OAuthClientOptions,
  signal?: AbortSignal,
  post?: PostOptions,
): Promise<PostResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(`${endpoints.accountOrigin}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(values),
    ...signal ? { signal } : {},
  })
  if (post?.tolerateMissing && (response.status === 404 || response.status === 405)) {
    return { ok: true, status: response.status, body: {} }
  }
  const body = asRecord(await response.json().catch(() => undefined))
  if (!body) throw new OAuthProtocolError('invalid_json_response', undefined, response.status)
  const error = readString(body, 'error')
  return { ok: response.ok && !error, status: response.status, body, ...error === undefined ? {} : { error } }
}

/**
 * Start a device authorization and return everything needed to finish it.
 * @param endpoints - region origins.
 * @param options - injectable collaborators.
 * @param signal - cancels the request.
 * @returns the pending authorization, including the PKCE verifier.
 */
export async function requestDeviceAuthorization(
  endpoints: RegionEndpoints,
  options: OAuthClientOptions = {},
  signal?: AbortSignal,
): Promise<DeviceAuthorization> {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url')
  const result = await postForm(endpoints, '/oauth2/device/code', {
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPE,
    audience: OAUTH_AUDIENCE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }, options, signal)
  if (!result.ok) throw new OAuthProtocolError(result.error ?? 'device_authorization_failed', undefined, result.status)

  const deviceCode = readString(result.body, 'device_code')
  const userCode = readString(result.body, 'user_code')
  const verificationUri = readString(result.body, 'verification_uri') ?? readString(result.body, 'verification_url')
  const expiresInSec = readPositiveNumber(result.body, 'expires_in')
  if (!deviceCode || !userCode || !verificationUri || !expiresInSec) {
    throw new OAuthProtocolError('invalid_device_authorization_response', undefined, result.status)
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: readString(result.body, 'verification_uri_complete'),
    expiresInSec,
    intervalSec: readPositiveNumber(result.body, 'interval') ?? DEFAULT_POLL_INTERVAL_SEC,
    codeVerifier,
  }
}

/**
 * Poll until the operator approves, the grant is denied, or it expires.
 *
 * The server signals a not-yet-approved attempt either with HTTP 400 plus
 * `authorization_pending` (RFC 8628) or with HTTP 200 plus a `status` field
 * (`pending` / `slow_down` / `denied`); both shapes are accepted because this
 * account service uses the second one.
 *
 * @param endpoints - region origins.
 * @param authorization - pending authorization from {@link requestDeviceAuthorization}.
 * @param options - injectable collaborators.
 * @param signal - stops polling.
 * @returns the granted token set.
 */
export async function pollDeviceToken(
  endpoints: RegionEndpoints,
  authorization: DeviceAuthorization,
  options: OAuthClientOptions = {},
  signal?: AbortSignal,
): Promise<TokenGrant> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = now() + authorization.expiresInSec * 1_000
  let intervalMs = authorization.intervalSec * 1_000

  while (now() < deadline) {
    signal?.throwIfAborted()
    const result = await postForm(endpoints, '/oauth2/token', {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: authorization.deviceCode,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: authorization.codeVerifier,
    }, options, signal)

    const status = readString(result.body, 'status')
    if (result.ok) {
      if (status === 'pending') {
        await sleep(intervalMs)
        continue
      }
      if (status === 'slow_down') {
        intervalMs += 5_000
        await sleep(intervalMs)
        continue
      }
      if (status === 'denied' || status === 'access_denied') throw new OAuthProtocolError('access_denied')
      if (status === 'expired' || status === 'expired_token') throw new OAuthProtocolError('expired_token')
      return parseTokenGrant(result.body, now())
    }

    if (result.error === 'authorization_pending' || result.error === 'slow_down') {
      if (result.error === 'slow_down') intervalMs += 5_000
      await sleep(intervalMs)
      continue
    }
    throw new OAuthProtocolError(result.error ?? 'device_authorization_failed', undefined, result.status)
  }
  throw new OAuthProtocolError('expired_token', 'The MiniMax device authorization expired before it was approved.')
}

/**
 * Exchange a refresh token for a new access token.
 * @param endpoints - region origins.
 * @param refreshToken - stored refresh token.
 * @param options - injectable collaborators.
 * @param signal - cancels the request.
 * @returns the granted token set; the server may or may not rotate the refresh token.
 */
export async function refreshAccessToken(
  endpoints: RegionEndpoints,
  refreshToken: string,
  options: OAuthClientOptions = {},
  signal?: AbortSignal,
): Promise<TokenGrant> {
  const result = await postForm(endpoints, '/oauth2/token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPE,
    audience: OAUTH_AUDIENCE,
  }, options, signal)
  if (!result.ok) throw new OAuthProtocolError(result.error ?? 'token_refresh_failed', undefined, result.status)
  return parseTokenGrant(result.body, (options.now ?? Date.now)(), refreshToken)
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
export async function revokeRefreshToken(
  endpoints: RegionEndpoints,
  refreshToken: string,
  options: OAuthClientOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  const result = await postForm(endpoints, '/oauth2/revoke', {
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: OAUTH_CLIENT_ID,
  }, options, signal, { tolerateMissing: true })
  if (!result.ok) throw new OAuthProtocolError(result.error ?? 'oauth_request_failed', undefined, result.status)
}

/** Validate one token response and project it onto {@link TokenGrant}. */
function parseTokenGrant(body: Record<string, unknown>, nowMs: number, previousRefreshToken?: string): TokenGrant {
  const accessToken = readString(body, 'access_token')
  const refreshToken = readString(body, 'refresh_token') ?? previousRefreshToken
  const tokenType = readString(body, 'token_type')
  const expiresInSec = readPositiveNumber(body, 'expires_in')
  const claims = accessToken ? decodeJwtPayload(accessToken) : undefined
  const scopes = parseScopes(body.scope ?? claims?.scope ?? claims?.scp)
  if (!accessToken
    || !refreshToken
    || tokenType?.toLowerCase() !== 'bearer'
    || !expiresInSec
    || !scopes.includes(OAUTH_SCOPE)) {
    throw new OAuthProtocolError('invalid_token_response')
  }
  return {
    accessToken,
    refreshToken,
    expiresAtMs: nowMs + expiresInSec * 1_000,
    scopes,
    accountId: readString(claims, 'account_id'),
    subject: readString(claims, 'sub'),
  }
}

/** Decode a JWT payload without verifying it; the transport is HTTPS-authenticated. */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segments = token.split('.')
  if (segments.length !== 3 || !segments[1]) return undefined
  try {
    return asRecord(JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')))
  }
  catch {
    return undefined
  }
}

/** Normalize a scope claim that may arrive as a string or an array. */
function parseScopes(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\s+/u).filter(Boolean)
  if (Array.isArray(value) && value.every(scope => typeof scope === 'string')) {
    return value.filter((scope): scope is string => typeof scope === 'string')
  }
  return []
}

/** Narrow a JSON value to an object with readable string keys. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function readString(value: unknown, key: string): string | undefined {
  const record = asRecord(value)
  const candidate = record?.[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

function readPositiveNumber(value: unknown, key: string): number | undefined {
  const record = asRecord(value)
  const candidate = record?.[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    ? candidate
    : undefined
}
