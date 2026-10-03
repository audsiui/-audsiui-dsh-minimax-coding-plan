/**
 * The MiniMax account as a Typert Remote service.
 *
 * This is the only channel a browser surface has to this process. dsh's Remote
 * contract is generated at build time from the `@Remote` methods below: the
 * generator derives a strict schema for every parameter and result, and the
 * Gateway validates the request before the method body runs. That is why the
 * methods here are deliberately plain — JSON records, no classes, no optional
 * parameters, and `signal` last where cancellation is wanted.
 *
 * The browser half never receives a token. `state()` projects the account onto
 * display fields, and `quota()` returns percentages.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { MinimaxAccount, type MinimaxAccountState } from './account.ts'
import type { RegionEndpoints } from './constants.ts'
import { fetchPlan, type PlanSnapshot } from './plan.ts'
import { fetchQuota, QuotaAuthError, type QuotaWindow } from './quota.ts'
import type {
  RemoteAccountView,
  RemotePlanView,
  RemoteQuotaView,
  RemoteQuotaWindow,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    minimaxRemote: MinimaxRemoteService
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A device-authorization attempt ended without a grant. */
    'minimax/sign-in-failed': { readonly reason: string }
  }
}

/** Collaborators and settings the Remote surface needs. */
export interface MinimaxRemoteOptions {
  /** The credential the surface's buttons act on. */
  readonly account: MinimaxAccount
  /** Region origins; `quotaOrigin` and `agentOrigin` are read. */
  readonly endpoints: RegionEndpoints
  /** Region name, reported back so a surface can show it. */
  readonly region: string
  /** Injectable transport and clock, forwarded to the usage read. */
  readonly fetchImpl?: typeof fetch | undefined
  readonly now?: (() => number) | undefined
}

/** Project the account's discriminated state onto the wire record. */
function toAccountView(state: MinimaxAccountState, region: string): RemoteAccountView {
  if (state.status === 'authorizing') {
    return {
      status: 'authorizing',
      userCode: state.userCode,
      verificationUri: state.verificationUriComplete ?? state.verificationUri,
      expiresInSec: state.expiresInSec,
      accountId: null,
      expiresAtMs: null,
      region,
    }
  }
  if (state.status === 'authenticated') {
    return {
      status: 'authenticated',
      userCode: null,
      verificationUri: null,
      expiresInSec: null,
      accountId: state.accountId ?? null,
      expiresAtMs: state.expiresAtMs,
      region,
    }
  }
  return {
    status: 'signed-out',
    userCode: null,
    verificationUri: null,
    expiresInSec: null,
    accountId: null,
    expiresAtMs: null,
    region,
  }
}

/** Project one allowance window onto the wire record. */
function toWindow(window: QuotaWindow): RemoteQuotaWindow {
  return {
    model: window.model,
    window: window.window,
    totalPercent: window.totalPercent,
    usedPercent: window.usedPercent,
    resetAtMs: window.resetAtMs ?? null,
    remainsMs: window.remainsMs ?? null,
    totalCount: window.totalCount ?? null,
    usedCount: window.usedCount ?? null,
    remainsCount: window.remainsCount ?? null,
    present: window.present,
    status: window.status ?? null,
    unlimited: window.unlimited,
  }
}

/** Project the plan read onto the wire record. */
function toPlanView(snapshot: PlanSnapshot): RemotePlanView {
  return {
    accountName: snapshot.accountName ?? null,
    accountId: snapshot.accountId ?? null,
    tier: snapshot.tier ?? null,
    planExpiresAtMs: snapshot.planExpiresAtMs ?? null,
    hasTokenPlan: snapshot.hasTokenPlan ?? null,
    subscriptionType: snapshot.subscriptionType ?? null,
    error: snapshot.error ?? null,
  }
}

/** A usage read that found no usable grant, with the reason already decided. */
function unusableQuota(authExpired: boolean, error: string, now: number): RemoteQuotaView {
  return { windows: [], fetchedAtMs: now, authExpired, error }
}

/**
 * A plan read that produced nothing.
 *
 * There is no `authExpired` flag here the way the usage read has one: both
 * origins reject the same grant, and the surface already reacts to that through
 * the usage read. A plan-only failure would otherwise be able to drive the page
 * into a re-sign-in the usage read would contradict.
 */
function unusablePlan(error: string): RemotePlanView {
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

/**
 * The account state, usage, and the two buttons, over `ctx.remote`.
 */
export class MinimaxRemoteService extends TypertRemoteService {
  // TypeScript `private`, not ES `#private`: a Cordis `Service` is handed out
  // through a tracking proxy that cannot reach native private fields.
  private readonly options: MinimaxRemoteOptions

  /**
   * @param ctx - context owning this service.
   * @param options - the account, origins, and test seams.
   */
  constructor(ctx: Context, options: MinimaxRemoteOptions) {
    // The namespace is an inline literal because the Typert generator reads it
    // syntactically: it resolves the binding by source text, not by evaluating
    // the module, so a `const` reference is a hard error rather than a
    // convenience it can fold.
    super(ctx, 'minimaxRemote', { namespace: 'minimax' })
    this.options = options
  }

  /**
   * Resolve the stored grant for a read against one of the service origins.
   *
   * Shared by {@link quota} and {@link plan} so the two cannot each attempt a
   * refresh of the same credential: the account refreshes once, on expiry, and
   * a second caller arriving a moment later gets the cached token.
   *
   * @returns the access token, or the reason there is none.
   */
  private async resolveGrant(): Promise<
    { readonly token: string } | { readonly authExpired: boolean, readonly error: string }
  > {
    const state = this.options.account.getState()
    if (state.status !== 'authenticated') {
      return { authExpired: false, error: 'not signed in' }
    }
    // Resolving the grant can reject on its own — a refresh that gets a 5xx or
    // a socket that dies — so it shares the read's fate. An exception escaping a
    // @Remote method is folded by the Gateway into `gateway/internal`
    // (`docs/cookbook/adding-a-remote-api.zh.md:53`), which would hand the
    // surface a failure it cannot tell from a quota outage.
    let token: string | undefined
    try {
      token = await this.options.account.resolveToken(this.options.endpoints.quotaOrigin)
    }
    catch (error) {
      return { authExpired: true, error: error instanceof Error ? error.message : String(error) }
    }
    if (token === undefined) {
      return { authExpired: true, error: 'the stored grant could not be resolved' }
    }
    return { token }
  }

  /**
   * Current account state. The surface's poll target.
   * @returns the display projection; never carries a token.
   */
  @Remote('state')
  state(): RemoteAccountView {
    return toAccountView(this.options.account.getState(), this.options.region)
  }

  /**
   * Begin a device-authorization attempt and return once it is under way.
   *
   * Resolving on the transition rather than on the kickoff is the whole point:
   * the code request is asynchronous, so a fire-and-forget return hands the
   * surface the pre-attempt `signed-out`. The surface's poll is gated on
   * observing `authorizing`, so it would never start, and the grant the operator
   * approves in the browser would land with nobody re-reading for it.
   *
   * A failure to *start* is the one thing this method reports as a failure, and
   * it reports it as `minimax/sign-in-failed` rather than letting the exception
   * escape: the Gateway folds anything a `@Remote` method throws into
   * `gateway/internal` (`docs/cookbook/adding-a-remote-api.zh.md:53`), which the
   * surface cannot tell from an internal fault. Everything after the transition
   * — a denial, an expiry, a revoked authorization — settles later, on the
   * account's own state, which the surface re-reads.
   *
   * @returns the authorizing state, including the code and verification page.
   * @throws {RemoteError} `minimax/sign-in-failed` when the code request itself fails.
   */
  @Remote('signIn')
  async signIn(): Promise<RemoteAccountView> {
    let state: MinimaxAccountState
    try {
      state = await this.options.account.beginSignIn()
    }
    catch (error) {
      throw new RemoteError(
        'minimax/sign-in-failed',
        'MiniMax device authorization could not be started.',
        { reason: error instanceof Error ? error.message : String(error) },
      )
    }
    return toAccountView(state, this.options.region)
  }

  /**
   * Revoke and remove the local grant.
   * @returns the signed-out state.
   */
  @Remote('signOut')
  async signOut(): Promise<RemoteAccountView> {
    await this.options.account.signOut()
    return toAccountView(this.options.account.getState(), this.options.region)
  }

  /**
   * Read the plan's metered windows.
   *
   * A read failure is reported in the returned record rather than thrown: the
   * surface must be able to distinguish "no grant yet" from "the service is
   * unreachable" and offer the right next step, and a thrown RemoteError would
   * collapse both into one failure branch.
   *
   * @returns the windows, or the reason there are none.
   */
  @Remote('quota')
  async quota(): Promise<RemoteQuotaView> {
    const now = (this.options.now ?? Date.now)()
    const grant = await this.resolveGrant()
    if (!('token' in grant)) {
      return unusableQuota(grant.authExpired, grant.error, now)
    }
    try {
      const snapshot = await fetchQuota({
        token: grant.token,
        endpoints: this.options.endpoints,
        fetchImpl: this.options.fetchImpl,
        now: this.options.now,
      })
      return {
        windows: snapshot.windows.map(toWindow),
        fetchedAtMs: snapshot.fetchedAtMs,
        authExpired: false,
        error: null,
      }
    }
    catch (error) {
      if (error instanceof QuotaAuthError) {
        return unusableQuota(true, error.message, now)
      }
      return unusableQuota(false, error instanceof Error ? error.message : String(error), now)
    }
  }

  /**
   * Read who is signed in and what plan they are on.
   *
   * Kept separate from {@link quota} rather than folded into it, so the two
   * reads fail independently: a plan outage must not blank a usage figure the
   * service already answered with, and a usage outage must not hide the tier
   * name. A failure is reported in the returned record for the same reason
   * `quota` does — the surface has to tell "no grant yet" from "unreachable".
   *
   * @returns the account and plan, or the reason there are none.
   */
  @Remote('plan')
  async plan(): Promise<RemotePlanView> {
    const grant = await this.resolveGrant()
    if (!('token' in grant)) {
      return unusablePlan(grant.error)
    }
    try {
      return toPlanView(await fetchPlan({
        token: grant.token,
        endpoints: this.options.endpoints,
        fetchImpl: this.options.fetchImpl,
      }))
    }
    catch (error) {
      return unusablePlan(error instanceof Error ? error.message : String(error))
    }
  }
}

export { RemoteError }
