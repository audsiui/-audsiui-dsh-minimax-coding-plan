/** Raised when the service answers but the grant is not usable. */
export class PlanAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PlanAuthError';
    }
}
/** Raised when a request never reached the service. */
export class PlanNetworkError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'PlanNetworkError';
    }
}
/**
 * Query the account read insists on.
 *
 * MiniMax's client sends seventeen parameters here; measured against the live
 * endpoint one at a time, only two are load-bearing — the rest are dropped by
 * the server whether present or not. Sending the two that matter means this
 * module does not have to invent a screen size, a browser name, or a device
 * id it has no way of knowing.
 */
const USER_INFO_QUERY = { device_platform: 'web', version_code: '22201' };
/** Read a non-empty string, treating the empty string as absent. */
function readText(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
/** Read an epoch instant in milliseconds. */
function readEpochMs(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
/** Read a boolean the service may omit. */
function readBool(value) {
    return typeof value === 'boolean' ? value : undefined;
}
/** Parse a JSON object, or report a body that is neither. */
function asRecord(text, what) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        // An edge interstitial or a login redirect, not a business answer. Report
        // it as a transport problem so the surface can offer a retry instead of
        // drawing a card that looks like a signed-out account.
        throw new PlanNetworkError(`${what} returned a non-JSON body`);
    }
    if (parsed === null || typeof parsed !== 'object') {
        throw new PlanNetworkError(`${what} returned a body that is not an object`);
    }
    return parsed;
}
/** One agent-origin request, with the shared headers and the two error shapes. */
async function agentFetch(doFetch, url, init, what) {
    let response;
    try {
        response = await doFetch(url, init);
    }
    catch (error) {
        throw new PlanNetworkError(`could not reach the MiniMax ${what}: ${String(error)}`, { cause: error });
    }
    if (response.status === 401) {
        // The only status class that means the grant itself is the problem. This
        // endpoint does not return the open platform's `1016` body, so the HTTP
        // status is the whole signal.
        throw new PlanAuthError(`the MiniMax grant was rejected by ${what} (HTTP 401)`);
    }
    const text = await response.text();
    const body = asRecord(text, what);
    // The two reads disagree about where a failure lives: `/v1/api/user/*`
    // answers `statusInfo.code`, `/matrix/*` answers `base_resp.status_code`.
    // Both are checked, because a 200 with a non-zero code is a business
    // rejection and rendering it as an empty card would be a lie.
    const base = (body.base_resp ?? {});
    if (base.status_code !== undefined && base.status_code !== 0) {
        throw new PlanNetworkError(`${what} error ${String(base.status_code)}: ${base.status_msg ?? 'unknown'}`);
    }
    const info = (body.statusInfo ?? {});
    if (info.code !== undefined && info.code !== 0) {
        throw new PlanNetworkError(`${what} error ${String(info.code)}: ${info.message ?? 'unknown'}`);
    }
    return body;
}
/**
 * Read the account identity and the plan it is on.
 *
 * A read that fails alone does not fail this: the surviving half is returned
 * with the reason in {@link PlanSnapshot.error}, so a plan outage thins the card
 * instead of emptying it and a usage outage cannot hide the tier name. Only
 * when *both* reads fail is there nothing left to show, and that throws.
 *
 * @param options - the grant to read with and the origins to read from.
 * @returns whatever the two reads produced, with the first failure's reason.
 * @throws {PlanAuthError} when the service rejects the grant on both reads.
 * @throws {PlanNetworkError} when neither read could be completed.
 */
export async function fetchPlan(options) {
    const doFetch = options.fetchImpl ?? fetch;
    const origin = options.endpoints.agentOrigin;
    const headers = {
        authorization: `Bearer ${options.token}`,
        accept: 'application/json',
        'content-type': 'application/json',
    };
    const query = new URLSearchParams(USER_INFO_QUERY).toString();
    const readAccount = async () => {
        const body = await agentFetch(doFetch, `${origin}/v1/api/user/info?${query}`, { headers }, 'the account service');
        const info = body.data?.userInfo;
        if (info === null || typeof info !== 'object')
            return { name: undefined, id: undefined };
        const user = info;
        // `realUserID` is the stable one; `userID` is the shorter public handle and
        // is only a fallback for a response that somehow omits the stable field.
        return {
            name: readText(user.name),
            id: readText(user.realUserID) ?? readText(user.userID),
        };
    };
    const readPlan = async () => {
        const body = await agentFetch(doFetch, `${origin}/matrix/api/v1/commerce/get_membership_info`, { method: 'POST', headers, body: JSON.stringify({}) }, 'the plan service');
        return {
            // `plan_name` is reported as the empty string on an account that is on a
            // token plan, and `token_plan_tier` is the field MiniMax's own client
            // reads for the tier name. `plan_name` is kept only as a fallback.
            tier: readText(body.token_plan_tier) ?? readText(body.plan_name),
            planExpiresAtMs: readEpochMs(body.token_plan_expires_at),
            hasTokenPlan: readBool(body.has_token_plan),
            subscriptionType: readText(body.subscription_type),
        };
    };
    // Both reads are attempted even when the first one fails, so a partial
    // outage degrades the card instead of emptying it. The reported error is the
    // first failure, which is the one that explains the missing half.
    // Both reads are attempted even when the first one fails, so a partial outage
    // degrades the card rather than emptying it. The reported reason is the first
    // failure, which is the one that explains the missing half.
    const failures = [];
    let account = { name: undefined, id: undefined };
    let plan = {
        tier: undefined,
        planExpiresAtMs: undefined,
        hasTokenPlan: undefined,
        subscriptionType: undefined,
    };
    try {
        account = await readAccount();
    }
    catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
    }
    try {
        plan = await readPlan();
    }
    catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
    }
    // Two failures means there is no value to return and only a reason. A single
    // rejection is the one case the surface can still draw something from, and it
    // must not be promoted to a failure that blanks the tier name or the account.
    if (failures.length === 2)
        throw failures[0];
    return {
        accountName: account.name,
        accountId: account.id,
        tier: plan.tier,
        planExpiresAtMs: plan.planExpiresAtMs,
        hasTokenPlan: plan.hasTokenPlan,
        subscriptionType: plan.subscriptionType,
        error: failures[0]?.message,
    };
}
//# sourceMappingURL=plan.js.map