/**
 * Coding Plan quota reads.
 *
 * `remains_percent` is a plain authenticated GET on the open platform. It
 * carries no request signature, and every failure comes back inside `base_resp`
 * rather than as an HTTP status class — a rejected credential still answers
 * HTTP 200.
 *
 * The credential goes in `Authorization: Bearer <token>`. This was wrong once:
 * an earlier version sent it as a bare `token` header, on the strength of a note
 * claiming this service checks that one instead. Verified against the live
 * endpoint with a real grant — a bare `token` header answers
 * `1016 invalid api key`, and the identical token answers `status_code: 0`
 * under the bearer header. Nothing else about the request differs.
 *
 * The body is `{ model_remains: [...], base_resp: {...} }`, one entry per model
 * family the plan meters — a real account returns `general` and `video`. Each
 * entry carries exactly two allowance windows and no monthly one: a short
 * `interval` window and a `weekly` window. There is no third field to read, so
 * this module reports those two per entry and leaves the absence alone rather
 * than inventing a monthly figure.
 *
 * Percentages arrive as strings with a trailing `%`. The *total* is a
 * percentage too, and it is not bounded by 100 — a real weekly window reported
 * `150%`. Clamping it would have turned a 150% allowance into a 100% one, so
 * totals are passed through and only the rendered ratio is bounded.
 *
 * A window is metered in one of two currencies and the two are not
 * interchangeable. `general` reports `-1` for every `*_count` and meters purely
 * in percentages; `video` reports real counts and meters in them. MiniMax's own
 * client picks the currency the same way — it reads the percentage pair for the
 * entry named `general` and the count triple for the `video` entry — so both are
 * carried here and the surface decides which to draw.
 *
 * The wire's own `*_status` is carried verbatim. A status of `3` means the
 * window is not metered at all, which is what MiniMax's client maps to its
 * "unlimited" flag; that mapping was dropped from this module once on the
 * strength of a guess that a `-1` count implied it, which is a different field
 * answering a different question. It is restored, keyed on the status the
 * service actually sends.
 */
import type { RegionEndpoints } from './constants.ts';
/** One allowance window, normalised away from the wire's percent strings. */
export interface QuotaWindow {
    /** `model_name` the server grouped this window under. */
    readonly model: string;
    /** Which window: `interval` or `weekly`. */
    readonly window: 'interval' | 'weekly';
    /** Allowance as a percentage. Not bounded by 100; a 150% plan is real. */
    readonly totalPercent: number;
    /** Consumed share of {@link totalPercent}, never negative. */
    readonly usedPercent: number;
    /** Epoch milliseconds the window resets, when the server reports it. */
    readonly resetAtMs: number | undefined;
    /** Milliseconds left in the window, as the server counts them. */
    readonly remainsMs: number | undefined;
    /**
     * Request-count allowance, when the window is metered in requests.
     *
     * The server sends `-1` for a window that is metered in percentages instead,
     * and a real account does exactly that on its `general` entry while reporting
     * a live `6% / 150%` weekly allowance. `-1` therefore means "this window has
     * no request-count quota", not "this window is unmetered" — the percentages
     * are the real figure there. `undefined` is that case; a number is a real
     * count. MiniMax's own client reads these to draw the `video` entry, so they
     * are not dropped.
     */
    readonly totalCount: number | undefined;
    /** Requests consumed from {@link totalCount}, when it is a real count. */
    readonly usedCount: number | undefined;
    /** Requests left, as the server counts them, when it counts at all. */
    readonly remainsCount: number | undefined;
    /**
     * Whether the response carried this window's own fields.
     *
     * The `*_count` fields being `-1` does **not** mean the window is unmetered.
     * That reading was tried and is wrong: a real account reports `-1` counts on
     * the `general` entry and still reports a live `6% / 150%` weekly allowance,
     * which the operator's own client displays for that same entry. `-1` means
     * there is no request-count quota attached — the allowance is expressed purely
     * as a share of a percentage — and the percentages are the real figure. A
     * count-based quota is only one of the two ways this service meters.
     */
    readonly present: boolean;
    /** The server's own window status, verbatim. */
    readonly status: number | undefined;
    /**
     * Whether the service reports this window as not metered.
     *
     * `3` is the status MiniMax's client maps to its "unlimited" flag, and the
     * mapping is taken from its parser rather than inferred: a real account
     * reports `1` on every window, so only a `3` here is evidence the service
     * considers a window unmetered, and nothing else is guessed at.
     */
    readonly unlimited: boolean;
}
/** Everything the console renders for one account. */
export interface QuotaSnapshot {
    readonly windows: readonly QuotaWindow[];
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
 * Read the current allowance windows for every model the plan meters.
 *
 * @param options - the grant to read with and the origins to read from.
 * @returns the windows, grouped by the model each was reported under.
 * @throws {QuotaAuthError} when the service rejects the grant.
 * @throws {QuotaNetworkError} when the request could not be completed.
 */
export declare function fetchQuota(options: QuotaClientOptions): Promise<QuotaSnapshot>;
//# sourceMappingURL=quota.d.ts.map