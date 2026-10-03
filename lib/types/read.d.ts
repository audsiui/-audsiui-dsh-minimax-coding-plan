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
import type { RegionEndpoints } from './constants.ts';
/** Which origins the readers may be pointed at. */
export type ServiceOrigin = RegionEndpoints['quotaOrigin'] | RegionEndpoints['agentOrigin'];
/** How a read failed, in the three ways a caller can act on differently. */
export type ReadFailure = 
/** The grant itself is refused: sign in again. */
'auth'
/** The service understood the request and said no. */
 | 'rejected'
/** The request never produced a usable answer. */
 | 'unreachable';
/** A read that failed, tagged with what kind of failure it was. */
export declare class ReadError extends Error {
    readonly failure: ReadFailure;
    readonly code: number | null;
    /**
     * @param failure - which of the three kinds this was.
     * @param message - the service's own wording, kept intact for the surface.
     * @param code - the service's own status code, when it sent one.
     * @param options - the underlying transport error, when there was one.
     */
    constructor(failure: ReadFailure, message: string, code?: number | null, options?: {
        cause?: unknown;
    });
}
/** The origin and the grant, plus the transport seam. */
export interface ReadClient {
    /** Which MiniMax service to talk to. */
    readonly origin: ServiceOrigin;
    /** Access token, already refreshed by the caller. */
    readonly token: string;
    /** Injectable transport; the seam every test crosses. */
    readonly fetchImpl?: typeof fetch | undefined;
}
/** What to ask for. */
export interface ReadRequest {
    /** Path below the origin, leading slash included. */
    readonly path: string;
    /** Defaults to `GET`. */
    readonly method?: 'GET' | 'POST';
    /** Query parameters; only some of MiniMax's routes want any. */
    readonly query?: Readonly<Record<string, string>>;
    /** Request body, JSON-encoded. Implies `POST` when no method is given. */
    readonly body?: unknown;
    /**
     * What this read is for, in the surface's language, e.g. `the quota service`.
     * Only ever appears in an error message, so a reader knows which of its own
     * requests failed without the caller matching on a path.
     */
    readonly label: string;
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
export declare function readJson(client: ReadClient, request: ReadRequest): Promise<Record<string, unknown>>;
//# sourceMappingURL=read.d.ts.map