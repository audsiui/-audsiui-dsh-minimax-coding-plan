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
 * display fields, and `quota()` and `plan()` hand back what their readers
 * already parsed: both readers produce the wire shape directly, so this module
 * projects only the account's discriminated state and otherwise decides which
 * origin to read and how a failure is worded.
 */
import type { Context } from '@deepseek-ai/cordis';
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { MinimaxAccount } from './account.ts';
import type { RegionEndpoints } from './constants.ts';
import type { RemoteAccountView, RemotePlanView, RemoteQuotaView } from './types.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        minimaxRemote: MinimaxRemoteService;
    }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** A device-authorization attempt ended without a grant. */
        'minimax/sign-in-failed': {
            readonly reason: string;
        };
    }
}
/** Collaborators and settings the Remote surface needs. */
export interface MinimaxRemoteOptions {
    /** The credential the surface's buttons act on. */
    readonly account: MinimaxAccount;
    /** Region origins; `quotaOrigin` and `agentOrigin` are read. */
    readonly endpoints: RegionEndpoints;
    /** Region name, reported back so a surface can show it. */
    readonly region: string;
    /** Injectable transport and clock, forwarded to the usage read. */
    readonly fetchImpl?: typeof fetch | undefined;
    readonly now?: (() => number) | undefined;
}
/**
 * The account state, usage, and the two buttons, over `ctx.remote`.
 */
export declare class MinimaxRemoteService extends TypertRemoteService {
    private readonly options;
    /**
     * @param ctx - context owning this service.
     * @param options - the account, origins, and test seams.
     */
    constructor(ctx: Context, options: MinimaxRemoteOptions);
    /**
     * Resolve the stored grant for a read against one of the service origins.
     *
     * Shared by {@link quota} and {@link plan} so the two cannot each attempt a
     * refresh of the same credential: the account refreshes once, on expiry, and
     * a second caller arriving a moment later gets the cached token.
     *
     * @returns the access token, or the reason there is none.
     */
    private resolveGrant;
    /**
     * Current account state. The surface's poll target.
     * @returns the display projection; never carries a token.
     */
    state(): RemoteAccountView;
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
    signIn(): Promise<RemoteAccountView>;
    /**
     * Revoke and remove the local grant.
     * @returns the signed-out state.
     */
    signOut(): Promise<RemoteAccountView>;
    /**
     * Read the plan's metered windows.
     *
     * A read failure is reported in the returned record rather than thrown: the
     * surface must be able to distinguish "no grant yet" from "the service is
     * unreachable" and offer the right next step, and a thrown RemoteError would
     * collapse both into one failure branch. This is the one read that keeps a
     * separate `authExpired` flag; `plan` does not need one, and giving it one
     * would let a plan-only 401 drive the page into a re-sign-in that the usage
     * read would contradict.
     *
     * @returns the windows, or the reason there are none.
     */
    quota(): Promise<RemoteQuotaView>;
    /**
     * Read who is signed in and what plan they are on.
     *
     * Kept separate from {@link quota} rather than folded into it, so the two
     * reads fail independently: a plan outage must not blank a usage figure the
     * service already answered with, and a usage outage must not hide the tier
     * name. `fetchPlan` reports its own failures in the record it returns, so
     * this method has nothing left to do but hand it across.
     *
     * @returns the account and plan, with any failure's reason in `error`.
     */
    plan(): Promise<RemotePlanView>;
}
export { RemoteError };
//# sourceMappingURL=remote.d.ts.map