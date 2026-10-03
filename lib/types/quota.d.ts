/**
 * Coding Plan quota reads.
 *
 * `remains_percent` is a plain authenticated GET on the open platform. It
 * carries no request signature: the header set is the access token plus JSON
 * content type, and every failure comes back inside `base_resp` rather than
 * as an HTTP error class. `1004` is the one that matters here — it means the
 * token is missing or stale, which is the signal to re-sign-in.
 *
 * The response describes exactly two allowance windows and no monthly one:
 * a short `interval` window and a `weekly` window. There is no third field to
 * read, so this module reports those two and leaves the absence alone rather
 * than inventing a monthly figure.
 */
import type { RegionEndpoints } from './constants.ts';
/** One allowance window, normalised away from the wire's percent strings. */
export interface QuotaWindow {
    /** Window identity, stable across responses. */
    readonly id: 'interval' | 'weekly';
    /** Human label for the console. */
    readonly label: string;
    /** Allowance as a percentage; `100` when the server omits or zeroes it. */
    readonly totalPercent: number;
    /** Consumed share of {@link totalPercent}, never negative. */
    readonly usedPercent: number;
    /** Epoch milliseconds the window resets, when the server reports it. */
    readonly resetAtMs: number | undefined;
    /** The server marked this window unlimited; the percentages are advisory. */
    readonly unlimited: boolean;
    /** False when the response carried none of this window's fields. */
    readonly present: boolean;
}
/** Everything the console renders for one account. */
export interface QuotaSnapshot {
    readonly windows: readonly QuotaWindow[];
    /** Subscription period reported alongside the windows, when available. */
    readonly planLabel: string | undefined;
    /** Fetched-at clock, so the console can say how stale the numbers are. */
    readonly fetchedAtMs: number;
}
/** Raised when the service answers but the grant is not usable. */
export declare class QuotaAuthError extends Error {
    readonly statusCode: number;
    constructor(statusCode: number, message: string);
}
/** Raised when the request never reached the service. */
export declare class QuotaNetworkError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** Collaborators, so the transport and clock are injectable in tests. */
export interface QuotaClientOptions {
    /** Access token for the open platform, already refreshed by the caller. */
    readonly token: string;
    /** Region origins; only `quotaOrigin` is used. */
    readonly endpoints: RegionEndpoints;
    /** Injectable transport and clock. */
    readonly fetchImpl?: typeof fetch | undefined;
    readonly now?: (() => number) | undefined;
}
/**
 * Read the current allowance windows.
 *
 * The token is sent as a bare `token` header, not `Authorization: Bearer` —
 * that is the header this service checks, and a bearer header alone answers
 * `1004` even with a valid grant.
 *
 * @param options - the grant to read with and the origins to read from.
 * @returns the parsed windows, or an empty list when the plan meters neither.
 * @throws {QuotaAuthError} when the service rejects the grant.
 * @throws {QuotaNetworkError} when the request could not be completed.
 */
export declare function fetchQuota(options: QuotaClientOptions): Promise<QuotaSnapshot>;
//# sourceMappingURL=quota.d.ts.map