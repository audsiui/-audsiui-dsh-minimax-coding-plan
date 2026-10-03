/**
 * Who is signed in, and what they bought.
 *
 * Two agent-origin reads, taken from MiniMax's own desktop client rather than
 * guessed: `GET /v1/api/user/info` for the account, and
 * `POST /matrix/api/v1/commerce/get_membership_info` for the plan. Both accept
 * the same `Authorization: Bearer` grant the quota read uses, and neither
 * requires a request signature — MiniMax's renderer computes `x-timestamp`,
 * `x-signature` and `yy`, but its Electron main process strips the `token` and
 * `authorization` headers before forwarding, so those signatures cover a body
 * the backend does not check. Omitting them was verified against the live
 * endpoints, not inferred.
 *
 * The two are read independently and neither can blank the other. A plan read
 * that fails still leaves the account name, and vice versa; the surface shows
 * whichever half arrived and says nothing about the other rather than implying
 * it is absent.
 *
 * ## What is deliberately not read
 *
 * `opcredit_balance` and `op_credit_summary.total_remaining_amount` disagree on
 * the same account: the balance reads `2912` while the summary reads
 * `"9402.216"`, and the summary's own breakdown shows why — `2912.216`
 * purchased plus `6490` free. The service is reporting a purchased balance and
 * a total under two field names, and nothing in the payload says which one a
 * caller is supposed to display. Rather than pick one and present it as "the"
 * balance, neither is carried here. That is a gap in what this module reports,
 * and it is left visible rather than papered over with a guess.
 */
import type { RegionEndpoints } from './constants.ts';
/** Who the grant belongs to, and what plan it is on. */
export interface PlanSnapshot {
    /** Display name the account service reported. */
    readonly accountName: string | undefined;
    /** Stable account id. The OAuth grant carries none — its access token is an
     *  opaque string, not a JWT — so this is the only source of an account id. */
    readonly accountId: string | undefined;
    /** Plan tier name, e.g. `Max`. Empty on the wire is reported as absent. */
    readonly tier: string | undefined;
    /** When the plan itself lapses, in epoch milliseconds. */
    readonly planExpiresAtMs: number | undefined;
    /** Whether the service considers this account to be on a token plan. */
    readonly hasTokenPlan: boolean | undefined;
    /** The service's own subscription kind, e.g. `token_plan`. */
    readonly subscriptionType: string | undefined;
    /** Why a read produced no values, when one did. */
    readonly error: string | undefined;
}
/** Raised when the service answers but the grant is not usable. */
export declare class PlanAuthError extends Error {
    constructor(message: string);
}
/** Raised when a request never reached the service. */
export declare class PlanNetworkError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** Collaborators, so the transport is injectable in tests. */
export interface PlanClientOptions {
    /** Access token for the agent origin, already refreshed by the caller. */
    readonly token: string;
    /** Region origins; only `agentOrigin` is read. */
    readonly endpoints: RegionEndpoints;
    readonly fetchImpl?: typeof fetch | undefined;
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
export declare function fetchPlan(options: PlanClientOptions): Promise<PlanSnapshot>;
//# sourceMappingURL=plan.d.ts.map