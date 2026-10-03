/**
 * Account service owning the MiniMax credential: one interactive device
 * authorization, then a self-refreshing access token.
 */
import { spawn } from 'node:child_process';
import { Service } from '@deepseek-ai/cordis';
import { TOKEN_REFRESH_MARGIN_MS } from "./constants.js";
import { OAuthProtocolError, pollDeviceToken, refreshAccessToken, requestDeviceAuthorization, revokeRefreshToken, } from "./oauth.js";
import { clearGrant, readGrant, writeGrant } from "./grant.js";
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
    /** Resolves once the in-flight attempt has reached `authorizing` or failed. */
    attemptReachedStart;
    markAttemptReachedStart;
    /** @param ctx - context owning this account. @param options - endpoints, storage, and test seams. */
    constructor(ctx, options) {
        super(ctx, 'minimaxAccount');
        this.options = options;
    }
    /** Read the current account state. */
    getState() {
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
     * @returns the authorizing state, or the state after a fast failure.
     */
    async beginSignIn() {
        this.attemptReachedStart = new Promise((resolve) => {
            this.markAttemptReachedStart = resolve;
        });
        this.signInAttempt ??= this.runSignIn().finally(() => {
            this.signInAttempt = undefined;
            // A failure before the code request settles must not leave a caller
            // waiting on a transition that is never going to happen.
            this.markAttemptReachedStart?.();
            this.markAttemptReachedStart = undefined;
        });
        await this.attemptReachedStart;
        return this.getState();
    }
    /**
     * Sign in through the device-authorization grant, or join the attempt
     * already running. The first caller owns the browser prompt and the polling
     * loop; later callers await the same outcome.
     * @returns the state after the attempt settles.
     */
    async signIn() {
        this.signInAttempt ??= this.runSignIn().finally(() => {
            this.signInAttempt = undefined;
        });
        return this.signInAttempt;
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
        return (await this.refreshStored(stored, stored.refreshToken)).accessToken;
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
            this.markAttemptReachedStart?.();
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
     * Refresh one stored grant, collapsing concurrent callers onto one request.
     *
     * @param stored - the record being refreshed, for the fields carried forward.
     * @param refreshToken - the non-undefined refresh token; `resolveToken` has
     *   already handled the no-refresh-token case, and taking it as a parameter
     *   keeps that guarantee visible here rather than re-asserted.
     */
    async refreshStored(stored, refreshToken) {
        this.refreshInFlight ??= (async () => {
            try {
                const grant = await refreshAccessToken(this.options.endpoints, refreshToken, this.options.client);
                await writeGrant(this.ctx, this.options.credentialsPath, grant, this.options.region);
                const next = {
                    schemaVersion: 1,
                    clientId: stored.clientId,
                    accessToken: grant.accessToken,
                    refreshToken: grant.refreshToken,
                    expiresAtMs: grant.expiresAtMs,
                    scopes: grant.scopes,
                    accountId: grant.accountId,
                    subject: grant.subject,
                    region: this.options.region,
                };
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
/** Open a URL with the platform's default handler; failures are non-fatal. */
export function openExternal(url) {
    let command;
    let args;
    if (process.platform === 'win32') {
        // The empty-string title keeps `start` from reading the URL as a window
        // title; `windowsHide` and a detached child keep a console from flashing.
        command = 'cmd';
        args = ['/c', 'start', '', url];
    }
    else if (process.platform === 'darwin') {
        command = 'open';
        args = [url];
    }
    else {
        command = 'xdg-open';
        args = [url];
    }
    try {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
    }
    catch {
        // A headless host has no browser; the logged URL and code are enough.
    }
}
export default MinimaxAccount;
//# sourceMappingURL=account.js.map