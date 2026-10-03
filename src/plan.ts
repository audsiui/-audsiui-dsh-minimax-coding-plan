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
import type { ReadClient } from './read.ts'
import { readJson } from './read.ts'
import type { RemotePlanView } from './types.ts'

/**
 * Query the account read insists on.
 *
 * MiniMax's client sends seventeen parameters here; measured against the live
 * endpoint one at a time, only two are load-bearing — the rest are dropped by
 * the server whether present or not. Sending the two that matter means this
 * module does not have to invent a screen size, a browser name, or a device id
 * it has no way of knowing.
 */
const USER_INFO_QUERY: Readonly<Record<string, string>> = {
  device_platform: 'web',
  version_code: '22201',
}

/** The plan read takes an empty body rather than no body. */
const EMPTY_BODY: Readonly<Record<string, never>> = {}

/** Read a non-empty string, treating the empty string as absent. */
function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Read an epoch instant in milliseconds. */
function readEpochMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Read a boolean the service may omit. */
function readBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Collaborators. The origin and grant, narrowed from the region's four. */
export interface PlanClientOptions extends ReadClient {}

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
export function failedPlan(error: string): RemotePlanView {
  return {
    accountName: null,
    accountId: null,
    tier: null,
    planExpiresAtMs: null,
    hasTokenPlan: null,
    subscriptionType: null,
    error,
  }
}

/** What one of the two reads produced: its half of the record, or a reason. */
interface ReadOutcome<T> {
  readonly value: T
  readonly reason: string | null
}

/** Wrap a read so it reports rather than throws, and say which half it filled. */
async function attempt<T>(read: () => Promise<T>, empty: T): Promise<ReadOutcome<T>> {
  try {
    return { value: await read(), reason: null }
  }
  catch (error) {
    return { value: empty, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** The account half: a display name and a stable id, or neither. */
interface AccountFields {
  readonly accountName: string | null
  readonly accountId: string | null
}

/** The plan half: what they bought, or nothing. */
interface PlanFields {
  readonly tier: string | null
  readonly planExpiresAtMs: number | null
  readonly hasTokenPlan: boolean | null
  readonly subscriptionType: string | null
}

const NO_ACCOUNT: AccountFields = { accountName: null, accountId: null }
const NO_PLAN: PlanFields = {
  tier: null,
  planExpiresAtMs: null,
  hasTokenPlan: null,
  subscriptionType: null,
}

/**
 * Read the account identity and the plan it is on.
 *
 * @param options - the origin to read from, the grant, and the transport.
 * @returns whatever the two reads produced, with any failure's reason in
 *   `error`. Never throws.
 */
export async function fetchPlan(options: PlanClientOptions): Promise<RemotePlanView> {
  // Both in flight at once and both settled before either result is used, so a
  // slow second read does not delay the first by a full round trip.
  const [account, plan] = await Promise.all([
    attempt<AccountFields>(async () => {
      const body = await readJson(options, {
        path: '/v1/api/user/info',
        query: USER_INFO_QUERY,
        label: 'the account service',
      })
      const user = ((body.data as Record<string, unknown> | undefined)?.userInfo ?? {}) as Record<string, unknown>
      return {
        // `realUserID` is the stable one; `userID` is the shorter public handle
        // and is only a fallback for a response that omits the former.
        accountName: readText(user.name),
        accountId: readText(user.realUserID) ?? readText(user.userID),
      }
    }, NO_ACCOUNT),

    attempt<PlanFields>(async () => {
      const body = await readJson(options, {
        path: '/matrix/api/v1/commerce/get_membership_info',
        body: EMPTY_BODY,
        label: 'the plan service',
      })
      return {
        // `plan_name` is reported as the empty string on an account that *is* on
        // a token plan, and `token_plan_tier` is the field MiniMax's own client
        // reads for the tier name. `plan_name` is kept only as a fallback.
        tier: readText(body.token_plan_tier) ?? readText(body.plan_name),
        planExpiresAtMs: readEpochMs(body.token_plan_expires_at),
        hasTokenPlan: readBool(body.has_token_plan),
        subscriptionType: readText(body.subscription_type),
      }
    }, NO_PLAN),
  ])

  // Both reads are attempted even when the first fails, so a partial outage
  // thins the card instead of emptying it. When both failed there is nothing
  // left to draw and the record says so. The reported reason is the account
  // read's, because that is the figure least likely to be missing
  // legitimately — a tier name can be absent from a plan read, an account name
  // never is.
  if (account.reason !== null && plan.reason !== null) {
    return failedPlan(account.reason)
  }

  return {
    ...account.value,
    ...plan.value,
    error: account.reason ?? plan.reason,
  }
}
