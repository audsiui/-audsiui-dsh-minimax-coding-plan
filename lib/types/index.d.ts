import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
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
export { Config, defaultCredentialsPath, endpointsFor } from './config.ts';
export { registerMinimaxAuthorization } from './authorization.ts';
export { MinimaxRemoteService, type MinimaxRemoteOptions } from './remote.ts';
export type { QuotaMeter, RemoteAccountStatus, RemoteAccountView, RemotePlanView, RemoteQuotaView, RemoteQuotaWindow, RemoteQuotaWindowId, RemoteSignInFailure, } from './types.ts';
export { GRANT_KEY } from './grant.ts';
export { MinimaxAccount, type MinimaxAccountOptions, type MinimaxAccountReader, type MinimaxAccountState, } from './account.ts';
export { OAUTH_AUDIENCE, OAUTH_CLIENT_ID, OAUTH_SCOPE, REGION_ENDPOINTS, TOKEN_REFRESH_MARGIN_MS, type Region, type RegionEndpoints, } from './constants.ts';
export declare const name = "llm-minimax-coding-plan";
export declare const inject: string[];
/**
 * Register the account service and the provider route backed by it.
 * @param ctx - context owning this plugin lifetime with the LLM registry injected.
 * @param config - parsed plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map