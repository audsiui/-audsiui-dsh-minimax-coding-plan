/**
 * Who is signed in, and what they bought.
 *
 * Two agent-origin reads, taken from MiniMax's own desktop client rather than
 * guessed at: `GET /v1/api/user/info` for the account, and
 * `POST /matrix/api/v1/commerce/get_membership_info` for the plan. `read.ts`
 * owns the request and the two error envelopes; this module owns the mapping
 * from those two bodies onto one record.
 *
 * ## One failure mode, on purpose
 *
 * `fetchPlan` never throws. Every outcome — including both reads failing — comes
 * back as a {@link RemotePlanView} with the reason in `error`. That is not
 * uniformity for its own sake: the surface keys "offer a re-sign-in" off the
 * *usage* read's `authExpired` flag, so a plan failure has no distinct action
 * behind it and a throw would buy nothing but a branch the caller has to know
 * about. It is also the same shape the usage read already presents, so the two
 * reads can be rendered from one code path.
 *
 * ## The two reads fail independently
 *
 * Both are attempted even when the first one fails, and a failure in one is
 * reported without discarding what the other already answered. An earlier
 * version documented that and then threw on any failure at all, which a test
 * caught: a plan outage blanked the account name and an account outage blanked
 * the tier name — exactly the coupling the split was meant to remove.
 *
 * ## What is deliberately not read
 *
 * `opcredit_balance` and `op_credit_summary.total_remaining_amount` disagree on
 * the same account: the balance reads `2912` while the summary reads
 * `"9402.216"`, and the summary's own breakdown shows why — `2912.216`
 * purchased plus `6490` free. The service is reporting a purchased balance and a
 * total under two field names, and nothing in the payload says which one a
 * caller is supposed to display. Rather than pick one and present it as "the"
 * balance, neither is carried. That is a gap in what this module reports, and it
 * is left visible rather than papered over with a guess.
 */
import type { ReadClient } from './read.ts';
import type { RemotePlanView } from './types.ts';
/** Collaborators. The origin and grant, narrowed from the region's four. */
export interface PlanClientOptions extends ReadClient {
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
export declare function failedPlan(error: string): RemotePlanView;
/**
 * Read the account identity and the plan it is on.
 *
 * @param options - the origin to read from, the grant, and the transport.
 * @returns whatever the two reads produced, with any failure's reason in
 *   `error`. Never throws.
 */
export declare function fetchPlan(options: PlanClientOptions): Promise<RemotePlanView>;
//# sourceMappingURL=plan.d.ts.map