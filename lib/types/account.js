/**
 * Account service owning the MiniMax credential: one interactive device
 * authorization, then a self-refreshing access token.
 */
import { Service } from '@deepseek-ai/cordis';
import { TOKEN_REFRESH_MARGIN_MS } from "./constants.js";
import { OAuthProtocolError, pollDeviceToken, refreshAccessToken, requestDeviceAuthorization, revokeRefreshToken, } from "./oauth.js";
import { clearGrant, readGrant, writeGrant } from "./grant.js";
import { openExternal } from "./openExternal.js";
import { toStoredCredential } from "./store.js";
/**
 * MiniMax Coding Plan credentials.
 *
 * The service hands out a token only for the origins this plugin is
 * configured with, so a misrouted request cannot leak the grant to a host
 * that happens to receive the header.
 */
export class MinimaxAccount extends Service {
    // Declared with TypeScript `private`, not ES `#private`: a Cordis `Service` is
    // handed out through a tracking proxy, and native private fields are not
    // reachable from a proxy that wraps the instance.
    options;
    state = { status: 'signed-out' };
    signInAttempt;
    refreshInFlight;
    /** Resolves once the in-flight attempt reaches `authorizing`; rejects if it fails first. */
    attemptReachedStart;
    markAttemptReachedStart;
    markAttemptFailed;
    /** @param ctx - context owning this account. @param options - endpoints, storage, and test seams. */
    constructor(ctx, options) {
        super(ctx, 'minimaxAccount');
        this.options = options;
    }
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
    getState() {
        return this.state;
    }
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
    async currentState() {
        // An attempt in flight owns the state. Reading storage here would report
        // signed out while the operator is standing on the verification page, which
        // is the one moment the surface most needs to see `authorizing`.
        if (this.state.status === 'authorizing')
            return this.state;
        const stored = await readGrant(this.ctx, this.options.credentialsPath);
        this.state = stored !== undefined && stored.region === this.options.region
            ? { status: 'authenticated', accountId: stored.accountId, expiresAtMs: stored.expiresAtMs }
            : { status: 'signed-out' };
        return this.state;
    }
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
    async beginSignIn() {
        await this.ensureAttempt().reachedStart;
        return this.getState();
    }
    /**
     * Sign in through the device-authorization grant, or join the attempt
     * already running. The first caller owns the browser prompt and the polling
     * loop; later callers await the same outcome.
     * @returns the state after the attempt settles.
     */
    async signIn() {
        return this.ensureAttempt().settled;
    }
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
    ensureAttempt() {
        if (this.signInAttempt !== undefined && this.attemptReachedStart !== undefined) {
            return { reachedStart: this.attemptReachedStart, settled: this.signInAttempt };
        }
        const reachedStart = new Promise((resolve, reject) => {
            this.markAttemptReachedStart = resolve;
            this.markAttemptFailed = reject;
        });
        void reachedStart.catch(() => { });
        const settled = this.runSignIn().finally(() => {
            this.signInAttempt = undefined;
            this.attemptReachedStart = undefined;
            this.markAttemptReachedStart = undefined;
            this.markAttemptFailed = undefined;
        });
        void settled.catch(() => { });
        this.signInAttempt = settled;
        this.attemptReachedStart = reachedStart;
        return { reachedStart, settled };
    }
    /**
     * Resolve a usable access token, refreshing it when it is close to expiry.
     *
     * Concurrent callers share one refresh so a burst of parallel turns issues
     * a single token request.
     *
     * @param url - the request destination or the configured inference base URL.
     * @returns the bearer token, or undefined when signed out or the URL is not the allowed origin.
     */
    async resolveToken(url) {
        if (!this.isAllowedOrigin(url))
            return undefined;
        const stored = await readGrant(this.ctx, this.options.credentialsPath);
        if (!stored)
            return undefined;
        if (stored.region !== this.options.region)
            return undefined;
        const now = (this.options.client?.now ?? Date.now)();
        if (stored.expiresAtMs - now > TOKEN_REFRESH_MARGIN_MS) {
            this.state = { status: 'authenticated', accountId: stored.accountId, expiresAtMs: stored.expiresAtMs };
            return stored.accessToken;
        }
        if (stored.refreshToken === undefined) {
            // The access token is spent and no refresh token was issued (RFC 8628
            // §3.5 makes it optional), so there is no way to mint another. Retire the
            // record and report signed out, rather than sending an expired — or
            // empty — bearer to the inference endpoint.
            this.ctx.logger.warn('minimax-account: the access token expired and no refresh token was issued; sign in again');
            await clearGrant(this.ctx, this.options.credentialsPath);
            this.state = { status: 'signed-out' };
            this.ctx.emit('minimax-account/signed-out');
            return undefined;
        }
        return (await this.refreshStored(stored.refreshToken)).accessToken;
    }
    /**
     * Drop a token the inference endpoint rejected.
     *
     * Only clears when the rejected token is still the stored one, so a late
     * 401 from a superseded login never signs out the current session.
     *
     * @param token - token captured by the rejected request.
     */
    async rejectToken(token) {
        const stored = await readGrant(this.ctx, this.options.credentialsPath);
        if (!stored || stored.accessToken !== token)
            return;
        this.refreshInFlight = undefined;
        await clearGrant(this.ctx, this.options.credentialsPath);
        this.state = { status: 'signed-out' };
        this.ctx.emit('minimax-account/signed-out');
    }
    /**
     * Revoke and remove the local grant. Local state is cleared even when the
     * revocation request fails, so sign-out always takes effect.
     */
    async signOut() {
        this.refreshInFlight = undefined;
        const stored = await readGrant(this.ctx, this.options.credentialsPath);
        if (stored) {
            try {
                if (stored.refreshToken === undefined) {
                    // Nothing was issued to revoke (RFC 8628 §3.5 makes it optional).
                    // The local grant still has to go, so this is not a failure.
                    this.ctx.logger.info('minimax-account: no refresh token was issued; removing the local grant without a revocation call');
                }
                else {
                    await revokeRefreshToken(this.options.endpoints, stored.refreshToken, this.options.client);
                }
            }
            catch (error) {
                this.ctx.logger.warn('minimax-account: revocation failed; removing the local grant anyway: %o', error);
            }
        }
        await clearGrant(this.ctx, this.options.credentialsPath);
        this.state = { status: 'signed-out' };
        this.ctx.emit('minimax-account/signed-out');
        return this.state;
    }
    /** Run one device authorization end to end. */
    async runSignIn() {
        const client = this.options.client;
        let authorization;
        try {
            authorization = await requestDeviceAuthorization(this.options.endpoints, client);
        }
        catch (error) {
            this.state = { status: 'signed-out' };
            // The attempt never started, so nobody waiting on the transition would
            // ever be released. Hand them the cause instead; see `beginSignIn`.
            this.markAttemptFailed?.(error);
            throw error;
        }
        this.state = {
            status: 'authorizing',
            userCode: authorization.userCode,
            verificationUri: authorization.verificationUri,
            verificationUriComplete: authorization.verificationUriComplete,
            expiresInSec: authorization.expiresInSec,
        };
        // The surface is waiting on exactly this transition; see `beginSignIn`.
        this.markAttemptReachedStart?.();
        this.ctx.logger.info('minimax-account: open %s and enter code %s to finish sign-in (valid for %ds)', authorization.verificationUriComplete ?? authorization.verificationUri, authorization.userCode, authorization.expiresInSec);
        if (this.options.openBrowser !== false) {
            openExternal(authorization.verificationUriComplete ?? authorization.verificationUri);
        }
        try {
            const grant = await pollDeviceToken(this.options.endpoints, authorization, client);
            await writeGrant(this.ctx, this.options.credentialsPath, grant, this.options.region);
            this.state = { status: 'authenticated', accountId: grant.accountId, expiresAtMs: grant.expiresAtMs };
            this.ctx.emit('minimax-account/authenticated');
            return this.state;
        }
        catch (error) {
            this.state = { status: 'signed-out' };
            throw error;
        }
    }
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
    async refreshStored(refreshToken) {
        this.refreshInFlight ??= (async () => {
            try {
                const grant = await refreshAccessToken(this.options.endpoints, refreshToken, this.options.client);
                // The record kept in memory and the record written to disk are built by
                // one function, so the two cannot describe different grants. It used to
                // be assembled twice — once here and once inside `writeGrant` — and only
                // agreed because `stored.clientId` happened to equal the constant.
                const next = toStoredCredential(grant, this.options.region);
                await writeGrant(this.ctx, this.options.credentialsPath, grant, this.options.region);
                this.state = { status: 'authenticated', accountId: next.accountId, expiresAtMs: next.expiresAtMs };
                return next;
            }
            catch (error) {
                // A terminal rejection (invalid_grant, revoked authorization) leaves a
                // refresh token that can never succeed again; retire it so the next
                // request asks the operator to sign in rather than looping.
                if (error instanceof OAuthProtocolError && error.httpStatus !== undefined && error.httpStatus < 500) {
                    await clearGrant(this.ctx, this.options.credentialsPath);
                    this.state = { status: 'signed-out' };
                }
                throw error;
            }
            finally {
                this.refreshInFlight = undefined;
            }
        })();
        return this.refreshInFlight;
    }
    /**
     * Accept only the origins this plugin itself talks to.
     *
     * Comparing parsed URL components rather than prefixes rejects lookalikes
     * such as `https://agent.minimax.cn.evil.test`, a non-HTTPS scheme, an
     * explicit port, and embedded credentials. The allowlist is the two
     * configured origins — inference and quota — not "any host we know of", so
     * adding a destination is a deliberate edit rather than a side effect.
     */
    isAllowedOrigin(url) {
        let candidate;
        try {
            candidate = new URL(url);
        }
        catch {
            return false;
        }
        if (candidate.protocol !== 'https:'
            || candidate.username !== ''
            || candidate.password !== ''
            || candidate.port !== '') {
            return false;
        }
        return this.allowedOrigins().some((allowed) => {
            try {
                return candidate.origin === new URL(allowed).origin;
            }
            catch {
                return false;
            }
        });
    }
    /** Configured origins permitted to receive the grant. */
    allowedOrigins() {
        return [this.options.endpoints.inferenceOrigin, this.options.endpoints.quotaOrigin];
    }
}
//# sourceMappingURL=account.js.map