/**
 * One authenticated JSON read against a MiniMax service, for every caller.
 *
 * This is the shared implementation behind `quota.ts` and `plan.ts`, which
 * between them talk to two origins across four paths. Written once here because
 * the three things that made it worth sharing are all things a caller must not
 * have to know separately, and one of them is easy to get wrong:
 *
 *   1. **The grant goes in `Authorization: Bearer`.** A bare `token` header was
 *      tried and is wrong: measured against the live endpoint across ten header
 *      combinations, every variant except the bearer one answers 401.
 *   2. **No request signature is required.** MiniMax's desktop client computes
 *      `x-timestamp`, `x-signature` and `yy`, but its Electron main process
 *      strips `token` and `authorization` before forwarding, so the backend is
 *      not checking them. Omitting them was verified, not inferred.
 *   3. **Two different error envelopes.** The open platform answers
 *      `base_resp.status_code`; the agent backend answers `statusInfo.code`.
 *      Both answer HTTP 200 for a rejected credential, so a reader that checked
 *      only the HTTP status would render a business failure as an empty result.
 *
 * This is an internal module: nothing outside the package's two readers imports
 * it, and it is not part of the published interface. Its test surface is the
 * `fetchImpl` an adapter supplies, not its exported functions.
 */
import type { RegionEndpoints } from './constants.ts'

/** Which origins the readers may be pointed at. */
export type ServiceOrigin = RegionEndpoints['quotaOrigin'] | RegionEndpoints['agentOrigin']

/** How a read failed, in the three ways a caller can act on differently. */
export type ReadFailure =
  /** The grant itself is refused: sign in again. */
  | 'auth'
  /** The service understood the request and said no. */
  | 'rejected'
  /** The request never produced a usable answer. */
  | 'unreachable'

/** A read that failed, tagged with what kind of failure it was. */
export class ReadError extends Error {
  /**
   * @param failure - which of the three kinds this was.
   * @param message - the service's own wording, kept intact for the surface.
   * @param code - the service's own status code, when it sent one.
   * @param options - the underlying transport error, when there was one.
   */
  constructor(
    readonly failure: ReadFailure,
    message: string,
    readonly code: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ReadError'
  }
}

/** The origin and the grant, plus the transport seam. */
export interface ReadClient {
  /** Which MiniMax service to talk to. */
  readonly origin: ServiceOrigin
  /** Access token, already refreshed by the caller. */
  readonly token: string
  /** Injectable transport; the seam every test crosses. */
  readonly fetchImpl?: typeof fetch | undefined
}

/** What to ask for. */
export interface ReadRequest {
  /** Path below the origin, leading slash included. */
  readonly path: string
  /** Defaults to `GET`. */
  readonly method?: 'GET' | 'POST'
  /** Query parameters; only some of MiniMax's routes want any. */
  readonly query?: Readonly<Record<string, string>>
  /** Request body, JSON-encoded. Implies `POST` when no method is given. */
  readonly body?: unknown
  /**
   * What this read is for, in the surface's language, e.g. `the quota service`.
   * Only ever appears in an error message, so a reader knows which of its own
   * requests failed without the caller matching on a path.
   */
  readonly label: string
}

/** The service's own base response envelope. */
interface BaseResp {
  readonly status_code?: number
  readonly status_msg?: string
}

/** The agent backend's own envelope, which is not the one above. */
interface StatusInfo {
  readonly code?: number
  readonly message?: string
}

/**
 * Perform one authenticated JSON read and return the parsed object.
 *
 * @param client - the origin, the grant, and the transport.
 * @param request - the path, method, query, body, and label.
 * @returns the response body as a record.
 * @throws {ReadError} `auth` when refused, `rejected` when the service said no,
 *   `unreachable` when no usable answer arrived.
 */
export async function readJson(client: ReadClient, request: ReadRequest): Promise<Record<string, unknown>> {
  const { origin, token } = client
  const { path, query, body, label } = request
  const method = request.method ?? (body === undefined ? 'GET' : 'POST')
  const search = query === undefined ? '' : `?${new URLSearchParams(query).toString()}`

  // `body` is omitted rather than set to undefined: under
  // `exactOptionalPropertyTypes` an explicit undefined is not a valid
  // `BodyInit`, and a GET carrying `"undefined"` is not a GET either.
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)

  let response: Response
  try {
    response = await (client.fetchImpl ?? fetch)(`${origin}${path}${search}`, init)
  }
  catch (error) {
    throw new ReadError('unreachable', `could not reach the MiniMax ${label}: ${String(error)}`, null, { cause: error })
  }

  const text = await response.text()

  // Parsed before anything is decided, because the two origins report the same
  // condition in different places and neither signal is optional:
  //   the open platform answers HTTP 200 with `base_resp.status_code`,
  //   the agent origin answers HTTP 401 with an empty body.
  // A body that is not a JSON object is recorded as absent rather than thrown
  // on here, so a 401 carrying a login redirect is still recognised as a 401.
  let answer: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object') answer = parsed as Record<string, unknown>
  }
  catch {
    answer = null
  }

  // The body speaks first when it speaks at all. A 401 that also carries a
  // business code is saying something more specific than "your token is bad" —
  // `1003 group-not-member` is an answer about membership, not about the
  // credential — and the surface acts on the difference, offering a retry where
  // a refusal would send the operator to re-sign-in for nothing.
  if (answer !== null) {
    const base = (answer.base_resp ?? {}) as BaseResp
    if (base.status_code !== undefined && base.status_code !== 0) {
      throw new ReadError(
        'rejected',
        `${label} error ${String(base.status_code)}: ${base.status_msg ?? 'unknown'}`,
        base.status_code,
      )
    }
    const info = (answer.statusInfo ?? {}) as StatusInfo
    if (info.code !== undefined && info.code !== 0) {
      throw new ReadError('rejected', `${label} error ${String(info.code)}: ${info.message ?? 'unknown'}`, info.code)
    }
  }

  // Then the status class, which is how the agent origin says it.
  if (response.status === 401) {
    throw new ReadError('auth', `the MiniMax grant was rejected by ${label} (HTTP 401)`)
  }

  if (answer === null) {
    // An edge interstitial or a login redirect, not a business answer.
    // Reporting it as unreachable keeps the surface showing something
    // retryable rather than an empty result that reads as "no quota".
    throw new ReadError('unreachable', `${label} returned a non-JSON body (HTTP ${response.status})`)
  }

  return answer
}
