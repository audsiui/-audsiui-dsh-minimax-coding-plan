import { Context, Service } from '@deepseek-ai/cordis';
import { type RegionEndpoints } from './constants.ts';
import { type OAuthClientOptions } from './oauth.ts';
declare module '@deepseek-ai/cordis' {
    interface Events {
        /** A new device grant was committed. @mode emit */
        'minimax-account/authenticated'(): void;
        /** Local credential removal has completed. @mode emit */
        'minimax-account/signed-out'(): void;
    }
    interface Context {
        minimaxAccount: MinimaxAccount;
    }
}
/** Observable account state, carrying no credential material. */
export type MinimaxAccountState = {
    readonly status: 'signed-out';
} | {
    readonly status: 'authorizing';
    readonly userCode: string;
    readonly verificationUri: string;
    readonly verificationUriComplete: string | undefined;
    readonly expiresInSec: number;
} | {
    readonly status: 'authenticated';
    readonly accountId: string | undefined;
    readonly expiresAtMs: number;
};
/** Collaborators and settings the account needs from its host. */
export interface MinimaxAccountOptions {
    /** Region origins this login is bound to. */
    readonly endpoints: RegionEndpoints;
    /** Region name, recorded alongside the stored grant. */
    readonly region: string;
    /** Absolute path of the credential file. */
    readonly credentialsPath: string;
    /** Open the verification page in the operator's browser. */
    readonly openBrowser?: boolean;
    /** Injectable transport, clock, and sleep for tests. */
    readonly client?: OAuthClientOptions;
}
/**
 * MiniMax Coding Plan credentials.
 *
 * The service hands out a token only for the origins this plugin is
 * configured with, so a misrouted request cannot leak the grant to a host
 * that happens to receive the header.
 */
export declare class MinimaxAccount extends Service {
    private readonly options;
    private state;
    private signInAttempt;
    private refreshInFlight;
    /** Resolves once the in-flight attempt reaches `authorizing`; rejects if it fails first. */
    private attemptReachedStart;
    private markAttemptReachedStart;
    private markAttemptFailed;
    /** @param ctx - context owning this account. @param options - endpoints, storage, and test seams. */
    constructor(ctx: Context, options: MinimaxAccountOptions);
    /** Read the current account state. */
    getState(): MinimaxAccountState;
    /**
     * Begin a device-authorization attempt and resolve once it is actually under
     * way, returning the `authorizing` state that carries the code.
     *
     * This is deliberately not {@link signIn}. `signIn` settles only once the
     * operator finishes approving, which is far too late to hand a surface
     * something to render; and the code request is asynchronous, so reading the
     * state at kickoff returns the pre-attempt `signed-out`. A surface whose poll
     * is gated on observing `authorizing` then never starts polling, and the grant
     * lands with nobody watching for it.
     *
     * A failure *before* the attempt starts — a refused code request, a 5xx, a
     * socket that dies — rejects with the cause instead. Resolving with a plain
     * `signed-out` would be indistinguishable from "the operator has not pressed
     * the button", which is exactly the failure the Remote contract has no way to
     * report: the caller declared `minimax/sign-in-failed` and could only throw it
     * from here.
     *
     * @returns the authorizing state.
     * @throws whatever ended the attempt before it reached `authorizing`.
     */
    beginSignIn(): Promise<MinimaxAccountState>;
    /**
     * Sign in through the device-authorization grant, or join the attempt
     * already running. The first caller owns the browser prompt and the polling
     * loop; later callers await the same outcome.
     * @returns the state after the attempt settles.
     */
    signIn(): Promise<MinimaxAccountState>;
    /**
     * Start the one device attempt, or hand back the one already running.
     *
     * Two promises come out of it because callers legitimately want different
     * edges: the surface needs the transition (to render the code), the flow
     * runner needs the outcome (to report a denial or an expiry). Both are handed
     * a handler at creation rather than at await, because neither caller is
     * obliged to await: `signIn` ignores `reachedStart` entirely, and a
     * `beginSignIn` that joins a long-running attempt attaches long after the
     * failure it needed. An unhandled rejection is a process-level event, not an
     * error the operator can see.
     *
     * @returns the attempt's transition and settlement promises.
     */
    private ensureAttempt;
    /**
     * Resolve a usable access token, refreshing it when it is close to expiry.
     *
     * Concurrent callers share one refresh so a burst of parallel turns issues
     * a single token request.
     *
     * @param url - the request destination or the configured inference base URL.
     * @returns the bearer token, or undefined when signed out or the URL is not the allowed origin.
     */
    resolveToken(url: string): Promise<string | undefined>;
    /**
     * Drop a token the inference endpoint rejected.
     *
     * Only clears when the rejected token is still the stored one, so a late
     * 401 from a superseded login never signs out the current session.
     *
     * @param token - token captured by the rejected request.
     */
    rejectToken(token: string): Promise<void>;
    /**
     * Revoke and remove the local grant. Local state is cleared even when the
     * revocation request fails, so sign-out always takes effect.
     */
    signOut(): Promise<MinimaxAccountState>;
    /** Run one device authorization end to end. */
    private runSignIn;
    /**
     * Refresh one stored grant, collapsing concurrent callers onto one request.
     *
     * @param stored - the record being refreshed, for the fields carried forward.
     * @param refreshToken - the non-undefined refresh token; `resolveToken` has
     *   already handled the no-refresh-token case, and taking it as a parameter
     *   keeps that guarantee visible here rather than re-asserted.
     */
    private refreshStored;
    /**
     * Accept only the origins this plugin itself talks to.
     *
     * Comparing parsed URL components rather than prefixes rejects lookalikes
     * such as `https://agent.minimax.cn.evil.test`, a non-HTTPS scheme, an
     * explicit port, and embedded credentials. The allowlist is the two
     * configured origins — inference and quota — not "any host we know of", so
     * adding a destination is a deliberate edit rather than a side effect.
     */
    private isAllowedOrigin;
    /** Configured origins permitted to receive the grant. */
    private allowedOrigins;
}
/** Open a URL with the platform's default handler; failures are non-fatal. */
export declare function openExternal(url: string): void;
export default MinimaxAccount;
//# sourceMappingURL=account.d.ts.map