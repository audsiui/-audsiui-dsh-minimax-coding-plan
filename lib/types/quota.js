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
 */
const AUTH_STATUS_CODES = new Set([1016]);
/**
 * The wire sends percentages as strings with a trailing `%`, and omits the
 * field entirely for a window the plan does not meter.
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
/** Allowance total. A plan metered above 100% keeps that number. */
function toTotal(value) {
    const parsed = parsePercent(value);
    return parsed !== undefined && parsed > 0 ? parsed : 100;
}
/** Consumed share, clamped at zero and treated as absent-but-zero. */
function toUsed(value) {
    const parsed = parsePercent(value);
    return parsed === undefined ? 0 : Math.max(0, parsed);
}
/** Parse an epoch instant that may arrive in seconds or milliseconds. */
function toEpochMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value > 1e11 ? value : value * 1000;
    }
    return undefined;
}
/** Parse a duration in milliseconds, dropping the `-1` the server uses for "none". */
function toDurationMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        return value;
    return undefined;
}
/** Parse a small integer field such as `*_status`. */
function toStatus(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/**
 * Parse a request count, treating the service's `-1` as "not counted here".
 * @param value - the raw `*_count` field.
 * @returns the count, or undefined when the window meters percentages instead.
 */
function toCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
/**
 * The status value MiniMax's client reads as "this window is not metered".
 *
 * Taken from its parser (`out/_next/static/chunks/15233-*.js`), which tests
 * `3 === current_interval_status` for the interval window and the matching
 * `current_weekly_status` for the weekly one. A real account reports `1`
 * throughout, so this is the only value with evidence behind it.
 */
const UNLIMITED_STATUS = 3;
/**
 * Whether the response carried this window's own fields.
 *
 * The `*_count` fields being `-1` does **not** mean the window is unmetered.
 * That reading was tried and is wrong: a real account reports `-1` counts on the
 * `general` entry and still reports a live `6% / 150%` weekly allowance, which
 * the operator's own client displays for that same entry. `-1` means there is no
 * request-count quota attached — the allowance is expressed purely as a share of
 * a percentage — and the percentages are the real figure. A count-based quota is
 * only one of the two ways this service meters.
 */
function isPresent(entry, ...fields) {
    return fields.some(field => entry[field] !== undefined);
}
/** Build one window from the paired total/used/status fields of a model entry. */
function readWindow(entry, model, window, totalField, usedField, statusField, resetField, remainsField, totalCountField, usedCountField, remainsCountField) {
    const status = toStatus(entry[statusField]);
    return {
        model,
        window,
        totalPercent: toTotal(entry[totalField]),
        usedPercent: toUsed(entry[usedField]),
        resetAtMs: toEpochMs(entry[resetField]),
        remainsMs: toDurationMs(entry[remainsField]),
        totalCount: toCount(entry[totalCountField]),
        usedCount: toCount(entry[usedCountField]),
        remainsCount: toCount(entry[remainsCountField]),
        // Presence is decided by the window's own percentage fields, which are the
        // figures the surface draws. The `*_count` fields are not consulted: see
        // QuotaWindow.present for why -1 there does not mean "unmetered".
        present: isPresent(entry, totalField, usedField, statusField, resetField),
        status,
        unlimited: status === UNLIMITED_STATUS,
    };
}
/**
 * Read the current allowance windows for every model the plan meters.
 *
 * @param options - the grant to read with and the origins to read from.
 * @returns the windows, grouped by the model each was reported under.
 * @throws {QuotaAuthError} when the service rejects the grant.
 * @throws {QuotaNetworkError} when the request could not be completed.
 */
export async function fetchQuota(options) {
    const doFetch = options.fetchImpl ?? fetch;
    const now = (options.now ?? Date.now)();
    const url = `${options.endpoints.quotaOrigin}/backend/account/token_plan/remains_percent`;
    let payload;
    try {
        const response = await doFetch(url, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${options.token}`,
                accept: 'application/json',
            },
        });
        const text = await response.text();
        try {
            payload = JSON.parse(text);
        }
        catch {
            // A non-JSON body means an edge interstitial or a login redirect, not a
            // business answer. Report it as a network problem so the console shows
            // something retryable rather than a misleading "no quota".
            throw new QuotaNetworkError(`quota service returned a non-JSON body (HTTP ${response.status})`);
        }
    }
    catch (error) {
        if (error instanceof QuotaNetworkError)
            throw error;
        throw new QuotaNetworkError(`could not reach the MiniMax quota service: ${String(error)}`, { cause: error });
    }
    if (payload === null || typeof payload !== 'object') {
        throw new QuotaNetworkError('quota service returned a body that is not an object');
    }
    const body = payload;
    const base = (body.base_resp ?? {});
    const code = base.status_code;
    if (code !== undefined && code !== 0) {
        const message = `quota service error ${String(code)}: ${base.status_msg ?? 'unknown'}`;
        if (AUTH_STATUS_CODES.has(code))
            throw new QuotaAuthError(code, message);
        throw new QuotaNetworkError(message);
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
        windows.push(readWindow(entry, model, 'interval', 'current_interval_total_percent', 'current_interval_used_percent', 'current_interval_status', 'end_time', 'remains_time', 'current_interval_total_count', 'current_interval_used_count', 'current_interval_remains_count'), readWindow(entry, model, 'weekly', 'current_weekly_total_percent', 'current_weekly_used_percent', 'current_weekly_status', 'weekly_end_time', 'weekly_remains_time', 'current_weekly_total_count', 'current_weekly_used_count', 'current_weekly_remains_count'));
    }
    return { windows, fetchedAtMs: now };
}
//# sourceMappingURL=quota.js.map