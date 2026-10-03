import { readJson, ReadError } from "./read.js";
/** One row per window the service meters. There is no third. */
const WINDOW_FIELDS = {
    interval: {
        totalPercent: 'current_interval_total_percent',
        usedPercent: 'current_interval_used_percent',
        status: 'current_interval_status',
        // The interval window ends at `end_time` and the weekly one at
        // `weekly_end_time`; `start_time`/`weekly_start_time` are the same figures
        // backwards and are not read.
        resetAt: 'end_time',
        remains: 'remains_time',
        totalCount: 'current_interval_total_count',
        usedCount: 'current_interval_used_count',
        remainsCount: 'current_interval_remains_count',
    },
    weekly: {
        totalPercent: 'current_weekly_total_percent',
        usedPercent: 'current_weekly_used_percent',
        status: 'current_weekly_status',
        resetAt: 'weekly_end_time',
        remains: 'weekly_remains_time',
        totalCount: 'current_weekly_total_count',
        usedCount: 'current_weekly_used_count',
        remainsCount: 'current_weekly_remains_count',
    },
};
/** Raised when the service answers but the grant is not usable. */
export class QuotaAuthError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'QuotaAuthError';
    }
}
/** Raised when the request never reached the service. */
export class QuotaNetworkError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'QuotaNetworkError';
    }
}
/**
 * Status code that means "this grant will not work, sign in again".
 *
 * Only `1016` is here because only `1016` has been observed. An earlier version
 * also listed `1004` on the strength of a note claiming the service distinguishes
 * a missing credential (`1004`) from a rejected one (`1016`); probing the live
 * endpoint with no header, an empty header, and two garbage bearers returns
 * `1016 invalid api key` for all four. There is no such distinction to make, and
 * the raw code travels in the message either way, so an unrecognised code still
 * reports what the server actually said.
 *
 * This belongs to the quota service and not to `read.ts`, which sees the same
 * shape of failure on the agent origin where it means something else.
 */
const AUTH_STATUS_CODES = new Set([1016]);
/**
 * The status value MiniMax's client reads as "this window is not metered".
 *
 * Taken from its parser, which tests `3 === current_interval_status` for the
 * interval window and the matching `current_weekly_status` for the weekly one. A
 * real account reports `1` throughout, so this is the only value with evidence
 * behind it and nothing else is guessed at.
 */
const UNLIMITED_STATUS = 3;
/**
 * The wire sends percentages as strings with a trailing `%`.
 * @param value - the raw field, of unknown shape.
 * @returns the number, or undefined when the field is absent or unusable.
 */
function parsePercent(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim().replace(/%$/u, '').trim();
    if (!text)
        return undefined;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
}
/** Parse an epoch instant that may arrive in seconds or milliseconds. */
function parseEpochMs(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        return null;
    return value > 1e11 ? value : value * 1000;
}
/** Parse a duration in milliseconds, dropping the `-1` the server uses for "none". */
function parseDurationMs(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
/**
 * Parse a request count, treating the service's `-1` as "not metered in requests".
 * @param value - the raw `*_count` field.
 * @returns the count, or null when this window meters percentages instead.
 */
function parseCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
/** Build one window from the fields its table row names. */
function readWindow(entry, model, window, fields) {
    const totalPercent = parsePercent(entry[fields.totalPercent]);
    const totalCount = parseCount(entry[fields.totalCount]);
    const status = typeof entry[fields.status] === 'number' ? entry[fields.status] : null;
    return {
        model,
        window,
        // A total is never zero or missing on a window that is metered at all, and
        // 100 is the service's own fallback for a window it does not meter above.
        // A 150% allowance is real and is not clamped.
        totalPercent: totalPercent !== undefined && totalPercent > 0 ? totalPercent : 100,
        usedPercent: Math.max(0, parsePercent(entry[fields.usedPercent]) ?? 0),
        resetAtMs: parseEpochMs(entry[fields.resetAt]),
        remainsMs: parseDurationMs(entry[fields.remains]),
        totalCount,
        usedCount: parseCount(entry[fields.usedCount]),
        remainsCount: parseCount(entry[fields.remainsCount]),
        // Counts win where the service sent them: it is the figure that decrements.
        // The percentage pair is still carried either way, because the service keeps
        // sending it and it is still true.
        meter: (totalCount !== null && totalCount > 0 ? 'count' : 'percent'),
        // Presence is decided by the window's own percentage fields, which every
        // metered window reports. The `*_count` fields are not consulted: a `-1`
        // there means no request-count quota is attached, not that the window goes
        // unmetered, and a real account reports `-1` counts alongside 6% / 150%.
        present: entry[fields.totalPercent] !== undefined
            || entry[fields.usedPercent] !== undefined
            || entry[fields.status] !== undefined
            || entry[fields.resetAt] !== undefined,
        status,
        unlimited: status === UNLIMITED_STATUS,
    };
}
/**
 * Read the current allowance windows for every model the plan meters.
 *
 * @param options - the origin to read from, the grant, and the transport.
 * @returns the windows, grouped by the model each was reported under.
 * @throws {QuotaAuthError} when the service rejects the grant.
 * @throws {QuotaNetworkError} when the request could not be completed.
 */
export async function fetchQuota(options) {
    let body;
    try {
        body = await readJson(options, {
            path: '/backend/account/token_plan/remains_percent',
            label: 'the quota service',
        });
    }
    catch (error) {
        if (error instanceof ReadError && error.failure === 'auth') {
            throw new QuotaAuthError(error.code ?? 0, error.message);
        }
        // A business rejection of `1016` is this service's way of saying the grant
        // is no good, and the surface has to be able to tell that from a transient
        // fault — it is the difference between offering a re-sign-in and offering a
        // retry. The code travels in the message either way.
        if (error instanceof ReadError && error.failure === 'rejected'
            && error.code !== null && AUTH_STATUS_CODES.has(error.code)) {
            throw new QuotaAuthError(error.code, error.message);
        }
        throw new QuotaNetworkError(error instanceof Error ? error.message : String(error), error instanceof Error ? { cause: error } : undefined);
    }
    // The windows live in `model_remains`, one entry per model family. A body
    // without it is a plan that meters nothing, not a shape change to guess at.
    const entries = Array.isArray(body.model_remains)
        ? body.model_remains.filter((entry) => entry !== null && typeof entry === 'object')
        : [];
    const windows = [];
    for (const entry of entries) {
        const model = typeof entry.model_name === 'string' && entry.model_name.trim()
            ? entry.model_name
            : 'unknown';
        for (const [id, fields] of Object.entries(WINDOW_FIELDS)) {
            windows.push(readWindow(entry, model, id, fields));
        }
    }
    return windows;
}
//# sourceMappingURL=quota.js.map