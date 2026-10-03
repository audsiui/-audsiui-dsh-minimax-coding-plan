import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export { Config, defaultCredentialsPath, endpointsFor } from './config.ts';
export { registerMinimaxAuthorization } from './authorization.ts';
export { MinimaxRemoteService, type MinimaxRemoteOptions } from './remote.ts';
export type { RemoteAccountStatus, RemoteAccountView, RemotePlanView, RemoteQuotaView, RemoteQuotaWindow, RemoteSignInFailure, } from './types.ts';
export { fetchPlan, PlanAuthError, PlanNetworkError, type PlanClientOptions, type PlanSnapshot } from './plan.ts';
export { fetchQuota, QuotaAuthError, QuotaNetworkError, type QuotaClientOptions, type QuotaSnapshot, type QuotaWindow, } from './quota.ts';
export { GRANT_KEY, grantPayload, parseGrantPayload, readGrant, writeGrant, clearGrant } from './grant.ts';
export { MinimaxAccount, type MinimaxAccountOptions, type MinimaxAccountState } from './account.ts';
export { OAUTH_AUDIENCE, OAUTH_CLIENT_ID, OAUTH_SCOPE, REGION_ENDPOINTS, TOKEN_REFRESH_MARGIN_MS, type Region, type RegionEndpoints, } from './constants.ts';
export { OAuthProtocolError, pollDeviceToken, refreshAccessToken, requestDeviceAuthorization, revokeRefreshToken, type DeviceAuthorization, type OAuthClientOptions, type TokenGrant, } from './oauth.ts';
export { clearCredential, readCredential, writeCredential, type StoredCredential } from './store.ts';
export declare const name = "llm-minimax-coding-plan";
export declare const inject: string[];
/**
 * Register the account service and the provider route backed by it.
 * @param ctx - context owning this plugin lifetime with the LLM registry injected.
 * @param config - parsed plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map