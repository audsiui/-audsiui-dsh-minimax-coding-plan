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
import { fetchQuota, QuotaAuthError, type QuotaWindow } from './quota.ts'
import type {
  RemoteAccountView,
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
  /** Region origins; only `quotaOrigin` is read. */
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
    id: window.id,
    label: window.label,
    totalPercent: window.totalPercent,
    usedPercent: window.usedPercent,
    resetAtMs: window.resetAtMs ?? null,
    unlimited: window.unlimited,
    present: window.present,
  }
}

/** A usage read that found no usable grant, with the reason already decided. */
function unusableQuota(authExpired: boolean, error: string, now: number): RemoteQuotaView {
  return { windows: [], planLabel: null, fetchedAtMs: now, authExpired, error }
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
   * Current account state. The surface's poll target.
   * @returns the display projection; never carries a token.
   */
  @Remote('state')
  state(): RemoteAccountView {
    return toAccountView(this.options.account.getState(), this.options.region)
  }

  /**
   * Begin a device-authorization attempt and return as soon as it is under
   * way. The grant takes as long as the operator takes to approve it, so the
   * surface polls {@link state} rather than holding a call open.
   * @returns the authorizing state, including the code and verification page.
   */
  @Remote('signIn')
  signIn(): RemoteAccountView {
    this.options.account.signIn().catch(() => {
      // The attempt's outcome is already visible through `state`, which is the
      // only channel this method reports on; a rejection here only means no
      // grant arrived, which the surface reads as a return to signed-out.
    })
    return toAccountView(this.options.account.getState(), this.options.region)
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
    const state = this.options.account.getState()
    if (state.status !== 'authenticated') {
      return unusableQuota(false, 'not signed in', now)
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
      return unusableQuota(true, error instanceof Error ? error.message : String(error), now)
    }
    if (token === undefined) {
      return unusableQuota(true, 'the stored grant could not be resolved', now)
    }
    try {
      const snapshot = await fetchQuota({
        token,
        endpoints: this.options.endpoints,
        fetchImpl: this.options.fetchImpl,
        now: this.options.now,
      })
      return {
        windows: snapshot.windows.map(toWindow),
        planLabel: snapshot.planLabel ?? null,
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
}

export { RemoteError }
