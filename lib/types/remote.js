var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { failedPlan, fetchPlan } from "./plan.js";
import { fetchQuota, QuotaAuthError } from "./quota.js";
/** Project the account's discriminated state onto the wire record. */
function toAccountView(state, region) {
    if (state.status === 'authorizing') {
        return {
            status: 'authorizing',
            userCode: state.userCode,
            verificationUri: state.verificationUriComplete ?? state.verificationUri,
            expiresInSec: state.expiresInSec,
            accountId: null,
            expiresAtMs: null,
            region,
        };
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
        };
    }
    return {
        status: 'signed-out',
        userCode: null,
        verificationUri: null,
        expiresInSec: null,
        accountId: null,
        expiresAtMs: null,
        region,
    };
}
/** The message a thrown value carries, for the surface to show. */
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * A usage read that found no usable grant, with the reason already decided.
 *
 * The window and the plan records need no equivalent helper: their readers
 * already produce the wire shape directly, so there is nothing left to project
 * and nothing to get out of step. This wrapper is genuinely this module's own,
 * because `authExpired` is a fact about the *grant* rather than about a read.
 */
function unusableQuota(authExpired, error, now) {
    return { windows: [], fetchedAtMs: now, authExpired, error };
}
/**
 * The account state, usage, and the two buttons, over `ctx.remote`.
 */
let MinimaxRemoteService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _state_decorators;
    let _signIn_decorators;
    let _signOut_decorators;
    let _quota_decorators;
    let _plan_decorators;
    return class MinimaxRemoteService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _state_decorators = [Remote('state')];
            _signIn_decorators = [Remote('signIn')];
            _signOut_decorators = [Remote('signOut')];
            _quota_decorators = [Remote('quota')];
            _plan_decorators = [Remote('plan')];
            __esDecorate(this, null, _state_decorators, { kind: "method", name: "state", static: false, private: false, access: { has: obj => "state" in obj, get: obj => obj.state }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _signIn_decorators, { kind: "method", name: "signIn", static: false, private: false, access: { has: obj => "signIn" in obj, get: obj => obj.signIn }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _signOut_decorators, { kind: "method", name: "signOut", static: false, private: false, access: { has: obj => "signOut" in obj, get: obj => obj.signOut }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _quota_decorators, { kind: "method", name: "quota", static: false, private: false, access: { has: obj => "quota" in obj, get: obj => obj.quota }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _plan_decorators, { kind: "method", name: "plan", static: false, private: false, access: { has: obj => "plan" in obj, get: obj => obj.plan }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        // TypeScript `private`, not ES `#private`: a Cordis `Service` is handed out
        // through a tracking proxy that cannot reach native private fields.
        options = __runInitializers(this, _instanceExtraInitializers);
        /**
         * @param ctx - context owning this service.
         * @param options - the account, origins, and test seams.
         */
        constructor(ctx, options) {
            // The namespace is an inline literal because the Typert generator reads it
            // syntactically: it resolves the binding by source text, not by evaluating
            // the module, so a `const` reference is a hard error rather than a
            // convenience it can fold.
            super(ctx, 'minimaxRemote', { namespace: 'minimax' });
            this.options = options;
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
        async resolveGrant() {
            const state = this.options.account.getState();
            if (state.status !== 'authenticated') {
                return { authExpired: false, error: 'not signed in' };
            }
            // Resolving the grant can reject on its own — a refresh that gets a 5xx or
            // a socket that dies — so it shares the read's fate. An exception escaping a
            // @Remote method is folded by the Gateway into `gateway/internal`
            // (`docs/cookbook/adding-a-remote-api.zh.md:53`), which would hand the
            // surface a failure it cannot tell from a quota outage.
            let token;
            try {
                token = await this.options.account.resolveToken(this.options.endpoints.quotaOrigin);
            }
            catch (error) {
                return { authExpired: true, error: error instanceof Error ? error.message : String(error) };
            }
            if (token === undefined) {
                return { authExpired: true, error: 'the stored grant could not be resolved' };
            }
            return { token };
        }
        /**
         * Current account state. The surface's poll target.
         * @returns the display projection; never carries a token.
         */
        state() {
            return toAccountView(this.options.account.getState(), this.options.region);
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
        async signIn() {
            let state;
            try {
                state = await this.options.account.beginSignIn();
            }
            catch (error) {
                throw new RemoteError('minimax/sign-in-failed', 'MiniMax device authorization could not be started.', { reason: error instanceof Error ? error.message : String(error) });
            }
            return toAccountView(state, this.options.region);
        }
        /**
         * Revoke and remove the local grant.
         * @returns the signed-out state.
         */
        async signOut() {
            await this.options.account.signOut();
            return toAccountView(this.options.account.getState(), this.options.region);
        }
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
        async quota() {
            const now = (this.options.now ?? Date.now)();
            const grant = await this.resolveGrant();
            if (!('token' in grant)) {
                return unusableQuota(grant.authExpired, grant.error, now);
            }
            try {
                return {
                    windows: await fetchQuota({
                        origin: this.options.endpoints.quotaOrigin,
                        token: grant.token,
                        fetchImpl: this.options.fetchImpl,
                    }),
                    fetchedAtMs: now,
                    authExpired: false,
                    error: null,
                };
            }
            catch (error) {
                if (error instanceof QuotaAuthError) {
                    return unusableQuota(true, error.message, now);
                }
                return unusableQuota(false, describe(error), now);
            }
        }
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
        async plan() {
            const grant = await this.resolveGrant();
            if (!('token' in grant)) {
                return failedPlan(grant.error);
            }
            return fetchPlan({
                origin: this.options.endpoints.agentOrigin,
                token: grant.token,
                fetchImpl: this.options.fetchImpl,
            });
        }
    };
})();
export { MinimaxRemoteService };
export { RemoteError };
//# sourceMappingURL=remote.js.map