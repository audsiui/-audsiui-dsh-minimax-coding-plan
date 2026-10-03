import { readJson } from "./read.js";
/**
 * Query the account read insists on.
 *
 * MiniMax's client sends seventeen parameters here; measured against the live
 * endpoint one at a time, only two are load-bearing — the rest are dropped by
 * the server whether present or not. Sending the two that matter means this
 * module does not have to invent a screen size, a browser name, or a device id
 * it has no way of knowing.
 */
const USER_INFO_QUERY = {
    device_platform: 'web',
    version_code: '22201',
};
/** The plan read takes an empty body rather than no body. */
const EMPTY_BODY = {};
/** Read a non-empty string, treating the empty string as absent. */
function readText(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}
/** Read an epoch instant in milliseconds. */
function readEpochMs(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
/** Read a boolean the service may omit. */
function readBool(value) {
    return typeof value === 'boolean' ? value : null;
}
/**
 * A plan record with nothing in it and a reason why.
 *
 * Exported because the one caller outside this module — the Remote's
 * "no grant to read with" branch — needs the same shape `fetchPlan` returns,
 * and building it twice is how the two drift apart.
 *
 * @param error - the reason, already worded for the surface.
 * @returns every field absent except the reason.
 */
export function failedPlan(error) {
    return {
        accountName: null,
        accountId: null,
        tier: null,
        planExpiresAtMs: null,
        hasTokenPlan: null,
        subscriptionType: null,
        error,
    };
}
/** Wrap a read so it reports rather than throws, and say which half it filled. */
async function attempt(read, empty) {
    try {
        return { value: await read(), reason: null };
    }
    catch (error) {
        return { value: empty, reason: error instanceof Error ? error.message : String(error) };
    }
}
const NO_ACCOUNT = { accountName: null, accountId: null };
const NO_PLAN = {
    tier: null,
    planExpiresAtMs: null,
    hasTokenPlan: null,
    subscriptionType: null,
};
/**
 * Read the account identity and the plan it is on.
 *
 * @param options - the origin to read from, the grant, and the transport.
 * @returns whatever the two reads produced, with any failure's reason in
 *   `error`. Never throws.
 */
export async function fetchPlan(options) {
    // Both in flight at once and both settled before either result is used, so a
    // slow second read does not delay the first by a full round trip.
    const [account, plan] = await Promise.all([
        attempt(async () => {
            const body = await readJson(options, {
                path: '/v1/api/user/info',
                query: USER_INFO_QUERY,
                label: 'the account service',
            });
            const user = (body.data?.userInfo ?? {});
            return {
                // `realUserID` is the stable one; `userID` is the shorter public handle
                // and is only a fallback for a response that omits the former.
                accountName: readText(user.name),
                accountId: readText(user.realUserID) ?? readText(user.userID),
            };
        }, NO_ACCOUNT),
        attempt(async () => {
            const body = await readJson(options, {
                path: '/matrix/api/v1/commerce/get_membership_info',
                body: EMPTY_BODY,
                label: 'the plan service',
            });
            return {
                // `plan_name` is reported as the empty string on an account that *is* on
                // a token plan, and `token_plan_tier` is the field MiniMax's own client
                // reads for the tier name. `plan_name` is kept only as a fallback.
                tier: readText(body.token_plan_tier) ?? readText(body.plan_name),
                planExpiresAtMs: readEpochMs(body.token_plan_expires_at),
                hasTokenPlan: readBool(body.has_token_plan),
                subscriptionType: readText(body.subscription_type),
            };
        }, NO_PLAN),
    ]);
    // Both reads are attempted even when the first fails, so a partial outage
    // thins the card instead of emptying it. When both failed there is nothing
    // left to draw and the record says so. The reported reason is the account
    // read's, because that is the figure least likely to be missing
    // legitimately — a tier name can be absent from a plan read, an account name
    // never is.
    if (account.reason !== null && plan.reason !== null) {
        return failedPlan(account.reason);
    }
    return {
        ...account.value,
        ...plan.value,
        error: account.reason ?? plan.reason,
    };
}
//# sourceMappingURL=plan.js.map