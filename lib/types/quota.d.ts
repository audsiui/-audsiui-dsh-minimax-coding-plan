/**
 * Coding Plan quota reads.
 *
 * `remains_percent` is a plain authenticated read on the open platform, and
 * `read.ts` owns how the request is made and how a rejection is recognised. This
 * module owns one thing: turning `model_remains` into windows a surface can
 * draw without re-deriving anything.
 *
 * The body is `{ model_remains: [...], base_resp: {...} }`, one entry per model
 * family the plan meters — a real account returns `general` and `video`. Each
 * entry carries exactly two allowance windows and no monthly one: a short
 * `interval` window and a `weekly` window. There is no third field to read, so
 * this module reports those two per entry and leaves the absence alone rather
 * than inventing a monthly figure.
 *
 * ## The window field map
 *
 * The two windows differ only in a prefix — `current_interval_*` against
 * `current_weekly_*` — plus which of the three timing fields each one uses. That
 * mapping is the whole reason this module exists, and it is data rather than
 * code: it is one table, each row naming the eight fields of its window, and
 * {@link readWindow} is the one loop that knows how to consume a row. Written
 * the other way round it was an eleven-parameter function that a caller had to
 * call correctly, by memory, with eight field names in the right order — the
 * interface was as complex as the implementation, which is the definition of a
 * module that is not earning its keep.
 *
 * ## Two currencies, one window
 *
 * A window is metered in requests or as a share of a percentage, and the service
 * reports `-1` for the counts when it means the latter: a real account sends
 * `-1` on `general` alongside a live `6% / 150%` weekly allowance, and real
 * counts on `video` alongside `0% / 100%`. So the counts are not a fallback for
 * a missing percentage, and the percentage is not a fallback for a missing
 * count. The window says which one it is in {@link RemoteQuotaWindow.meter},
 * decided here from what actually arrived, and the surface draws that.
 *
 * ## Two claims that were removed
 *
 * `*_status === 3` means the window is not metered, which is what MiniMax's own
 * client maps to its "unlimited" flag. That mapping was dropped from this module
 * once on the strength of a guess that a `-1` count implied it — a different
 * field answering a different question — and is restored, keyed on the status
 * the service sends, per window rather than per model.
 *
 * The counts themselves were dropped for a while on the same kind of reasoning,
 * which cost the `video` entry its real 21-request weekly budget and drew it as
 * `0% / 100%` instead.
 */
import type { ReadClient } from './read.ts';
import type { RemoteQuotaWindow } from './types.ts';
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
/** Collaborators. The origin and grant, narrowed from the region's four. */
export type QuotaClientOptions = ReadClient;
/**
 * Read the current allowance windows for every model the plan meters.
 *
 * @param options - the origin to read from, the grant, and the transport.
 * @returns the windows, grouped by the model each was reported under.
 * @throws {QuotaAuthError} when the service rejects the grant.
 * @throws {QuotaNetworkError} when the request could not be completed.
 */
export declare function fetchQuota(options: QuotaClientOptions): Promise<RemoteQuotaWindow[]>;
//# sourceMappingURL=quota.d.ts.map