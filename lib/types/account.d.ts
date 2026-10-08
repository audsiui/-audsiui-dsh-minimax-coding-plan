/**
 * Account service owning the MiniMax credential: one interactive device
 * authorization, then a self-refreshing access token.
 */
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
 * What a consumer of the account needs, stated as an interface rather than a class.
 *
 * The service is a Cordis `Service`, which the host hands out through a tracking
 * proxy — so depending on the class means depending on the whole thing, lifecycle
 * and private state included. The readers on the other side of the seam
 * ([`MinimaxRemoteService`](./remote.ts) and the provider binding) use three
 * methods and nothing else, and naming that makes it a seam with two adapters
 * rather than a convention: the real service, and the hand-written stand-ins the
 * tests drive the readers with.
 */
export interface MinimaxAccountReader {
    /**
     * This process's cached reading. Signed out until something has read the
     * stored grant this process; see {@link MinimaxAccountReader.currentState}.
     */
    getState(): MinimaxAccountState;
    /** The account state, resolved from storage when this process has not read it. */
    currentState(): Promise<MinimaxAccountState>;
    /** Begin a device-authorization attempt and resolve once it is under way. */
    beginSignIn(): Promise<MinimaxAccountState>;
    /** Revoke and remove the grant. Local state is cleared even if revocation fails. */
    signOut(): Promise<MinimaxAccountState>;
    /** Drop a token the inference endpoint rejected, if it is still the stored one. */
    rejectToken(token: string): Promise<void>;
    /** Resolve a usable access token for a destination, refreshing when it is close to expiry. */
    resolveToken(url: string): Promise<string | undefined>;
}
/**
 * MiniMax Coding Plan credentials.
 *
 * The service hands out a token only for the origins this plugin is
 * configured with, so a misrouted request cannot leak the grant to a host
 * that happens to receive the header.
 */
export declare class MinimaxAccount extends Service implements MinimaxAccountReader {
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
    /**
     * This process's cached reading of the account state.
     *
     * It starts signed out and only becomes true once something has read the
     * stored grant in this process — a Host restart leaves it that way even
     * though the credential is on disk and perfectly usable. A caller asking
     * "who is signed in" wants {@link currentState}; this exists for the callers
     * that legitimately want the cheap, possibly-stale answer, which is the code
     * running immediately after {@link currentState} or {@link resolveToken}.
     */
    getState(): MinimaxAccountState;
    /**
     * The account state, resolved from storage.
     *
     * This is the answer to "who is signed in", and the only one that survives a
     * restart: the state is cached in memory and nothing reads the persisted grant
     * until a token is actually needed, so a Host started with a valid grant on
     * disk would otherwise report itself signed out to every surface until the
     * operator happened to send a message.
     *
     * It does **not** refresh. A grant inside its refresh margin is still a grant,
     * and refreshing is {@link resolveToken}'s job; keeping the two apart is what
     * stops a surface poll from minting tokens.
     *
     * @returns the state, and caches it for {@link getState}.
     */
    currentState(): Promise<MinimaxAccountState>;
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
     * Refresh the stored grant, collapsing concurrent callers onto one request.
     *
     * The new record is rebuilt from the refresh response rather than patched onto
     * the old one, so a server that rotates the refresh token — and one that does
     * not — both leave a record the next reader can validate.
     *
     * @param refreshToken - the stored refresh token. `resolveToken` has already
     *   handled the case where there is none, so taking it as a parameter keeps
     *   that guarantee visible here rather than re-asserted.
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
//# sourceMappingURL=account.d.ts.map