import { registerDeepSeekProvider } from '@deepseek-ai/dsh-llm-deepseek';
import { MinimaxAccount } from "./account.js";
import { registerMinimaxAuthorization } from "./authorization.js";
import { MinimaxRemoteService } from "./remote.js";
import { endpointsFor } from "./config.js";
import { createMinimaxProviderBinding } from "./provider.js";
/**
 * The published interface of the MiniMax Coding Plan provider.
 *
 * Everything a consumer needs and nothing else: the Cordis plugin entry, the
 * configuration schema, the account service, the Remote service the browser half
 * is dispatched through, and the wire vocabulary those two are described in.
 *
 * What used to be here as well — the credential encoders, the authenticated
 * read, the two readers, the OAuth protocol client — is implementation, and its
 * own modules say so. `read.ts` is explicit that it "is not part of the published
 * interface"; shipping it under `.` contradicted that and asked every consumer to
 * learn it. Those symbols are reachable through the `./testing` entry instead,
 * which is the seam the verification gates cross and which is named for what it
 * is. See `src/testing.ts`.
 *
 * The rule this barrel follows: a symbol earns a place here if a caller outside
 * this package has to know it to use the plugin correctly. The credential key
 * does — it identifies the stored grant in the harness's own credential surface.
 * The grant encoders do not; they are how the plugin happens to persist one.
 */
export { Config, defaultCredentialsPath, endpointsFor } from "./config.js";
export { registerMinimaxAuthorization } from "./authorization.js";
export { MinimaxRemoteService } from "./remote.js";
export { GRANT_KEY } from "./grant.js";
export { MinimaxAccount, } from "./account.js";
export { OAUTH_AUDIENCE, OAUTH_CLIENT_ID, OAUTH_SCOPE, REGION_ENDPOINTS, TOKEN_REFRESH_MARGIN_MS, } from "./constants.js";
export const name = 'llm-minimax-coding-plan';
export const inject = ['llm'];
/** Provider route this plugin owns. */
const PROVIDER = 'minimax-coding-plan';
/**
 * Register the account service and the provider route backed by it.
 * @param ctx - context owning this plugin lifetime with the LLM registry injected.
 * @param config - parsed plugin configuration.
 */
export function apply(ctx, config) {
    const endpoints = endpointsFor(config.region);
    // Offered as a harness authorization flow rather than only as a service
    // method: the seam owns cancellation, one-attempt-per-key, and commit
    // confirmation, and it is what the agent-facing API can drive. Injected
    // rather than read directly, so a profile without the seam still loads.
    ctx.inject(['authorization'], (child) => {
        registerMinimaxAuthorization(child, config);
    });
    const account = new MinimaxAccount(ctx, {
        endpoints,
        region: config.region,
        credentialsPath: config.credentialsPath,
        openBrowser: config.openBrowser,
    });
    // The browser surface's only route to this process. `dsh-typert-loader`
    // discovers the service through the generated `./typert` entry and the
    // Gateway dispatches `POST /api/minimax/<method>` to it, validating every
    // argument against the schema the generator derived from these signatures.
    new MinimaxRemoteService(ctx, {
        account,
        endpoints,
        region: config.region,
    });
    ctx.llm.registerConfigurableProviders([{
            provider: PROVIDER,
            displayName: 'MiniMax Coding Plan',
            settingsNs: ctx.fiber.entry?.options.id ?? name,
            settingsPath: [],
        }]);
    // The provider is the account: how a request gets its bearer, and what a
    // rejection means, are decided in `provider.ts` rather than here.
    registerDeepSeekProvider(ctx, PROVIDER, {
        ...createMinimaxProviderBinding(ctx, account, config, endpoints),
        providerName: 'MiniMax Coding Plan',
    });
}
// No `export default apply`. Cordis's plugin loader normalises module shapes
// with `exports = exports.default ?? exports` before handing the plugin to
// `ctx.plugin()`, and reads `inject` off whatever that yields. A default export
// therefore replaces the module namespace with the bare `apply` function, whose
// `inject` is `undefined` — the fiber stops waiting for `llm`, runs `apply`
// immediately, and fails with `cannot get property "llm" without inject`.
// Exporting `apply` and `inject` as named exports is what keeps the dependency
// declaration attached. `@deepseek-ai/dsh-llm-deepseek-account`, the first-party
// equivalent of this plugin, likewise has no default export.
//# sourceMappingURL=index.js.map