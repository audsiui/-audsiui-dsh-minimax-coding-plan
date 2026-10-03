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
 * Server status codes that mean "this grant will not work, sign in again".
 *
 * `1004` is `not login` — the service saw no credential at all. `1016` is
 * `invalid api key`, which is what the same service answers when a credential
 * *is* present but rejected. Verified against the live endpoint: an omitted
 * credential and a rejected one produce different codes, so mapping only the
 * first would report a stale grant as a transient network problem and never
 * offer the operator a way back in.
 */
const AUTH_STATUS_CODES = new Set([1004, 1016]);
/** Window status meaning the allowance does not actually cap usage. */
const UNLIMITED_STATUS = 3;
/**
 * The wire sends percentages as strings, sometimes with a trailing `%`, and
 * omits the field entirely for a window the plan does not meter.
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
/** Allowance total, defaulting to a full window when the server omits it. */
function toTotal(value) {
    const parsed = parsePercent(value);
    return parsed !== undefined && parsed > 0 ? parsed : 100;
}
/** Consumed share, clamped at zero and treated as absent-but-zero. */
function toUsed(value) {
    const parsed = parsePercent(value);
    return parsed === undefined ? 0 : Math.max(0, parsed);
}
/** Parse a reset instant that may be epoch seconds, millis, or ISO-ish text. */
function toResetAt(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 ? (value > 1e11 ? value : value * 1000) : undefined;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
/** Coerce an arbitrary percentage into a 0..100 whole number. */
function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
/** Build one window from the response's paired total/used/status fields. */
function readWindow(source, id, label, totalField, usedField, statusField, resetField) {
    const total = toTotal(source[totalField]);
    const used = clampPercent(toUsed(source[usedField]));
    return {
        id,
        label,
        totalPercent: clampPercent(total),
        // Clamp against the window's own total so a server-side rounding
        // overshoot cannot render as more than 100% consumed.
        usedPercent: Math.min(used, clampPercent(total)),
        resetAtMs: toResetAt(source[resetField]),
        unlimited: source[statusField] === UNLIMITED_STATUS,
        present: source[totalField] !== undefined
            || source[usedField] !== undefined
            || source[statusField] !== undefined
            || source[resetField] !== undefined,
    };
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
export async function fetchQuota(options) {
    const doFetch = options.fetchImpl ?? fetch;
    const now = (options.now ?? Date.now)();
    const url = `${options.endpoints.quotaOrigin}/backend/account/token_plan/remains_percent`;
    let payload;
    try {
        const response = await doFetch(url, {
            method: 'GET',
            headers: {
                token: options.token,
                'content-type': 'application/json',
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
        if (AUTH_STATUS_CODES.has(code)) {
            throw new QuotaAuthError(code, base.status_msg ?? 'the MiniMax grant was rejected');
        }
        throw new QuotaNetworkError(`quota service error ${String(code)}: ${base.status_msg ?? 'unknown'}`);
    }
    // The windows live at the top level next to `base_resp`; tolerate a nested
    // `data` envelope so a future shape change degrades to "no data" instead of
    // reading unrelated keys as percentages.
    const source = (body.data !== null && typeof body.data === 'object' ? body.data : body);
    const windows = [
        readWindow(source, 'interval', '本周期（5 小时窗口）', 'current_interval_total_percent', 'current_interval_used_percent', 'current_interval_status', 'end_time'),
        readWindow(source, 'weekly', '本周', 'current_weekly_total_percent', 'current_weekly_used_percent', 'current_weekly_status', 'weekly_end_time'),
    ];
    const planName = source.plan_name ?? source.planName ?? body.plan_name;
    return {
        windows,
        planLabel: typeof planName === 'string' && planName.trim() ? planName : undefined,
        fetchedAtMs: now,
    };
}
//# sourceMappingURL=quota.js.map