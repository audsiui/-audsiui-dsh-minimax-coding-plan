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
import type { Context } from '@deepseek-ai/cordis';
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { MinimaxAccount } from './account.ts';
import type { RegionEndpoints } from './constants.ts';
import type { RemoteAccountView, RemoteQuotaView } from './types.ts';
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
    /** Region origins; only `quotaOrigin` is read. */
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
     * @returns the authorizing state, including the code and verification page.
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
     * collapse both into one failure branch.
     *
     * @returns the windows, or the reason there are none.
     */
    quota(): Promise<RemoteQuotaView>;
}
export { RemoteError };
//# sourceMappingURL=remote.d.ts.map