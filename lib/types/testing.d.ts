/**
 * The verification gates' seam into this package's internals.
 *
 * The three gates — `wiring.mjs`, `quota-smoke.mjs` and `quota-probe.mjs` — are
 * most valuable when they exercise the *built artifact*, not the sources, because
 * that is the only arrangement that proves a third-party install will work. But
 * they also reach past the plugin's own entry point, into the credential
 * encoders and the two readers, to test them directly and hermetically rather
 * than through a running Host.
 *
 * Those two facts used to be served by one thing: the package's main barrel
 * exported everything, internal modules included. That made the published
 * interface a list of implementation details a consumer was never meant to learn
 * — and contradicted this package's own source, which describes several of those
 * modules as explicitly internal.
 *
 * So the surface is split at its real seam. `.` is what a consumer needs.
 * `./testing` is what a gate needs, and it says so in its name. Deleting this
 * entry removes the internals from the published interface without touching a
 * single test, and moving a gate onto the plugin's real surface is a one-line
 * import change.
 *
 * Nothing here is stable across releases. It is a test seam, not an API.
 */
export { GRANT_KEY, clearGrant, readGrant, writeGrant, } from './grant.ts';
export { clearCredential, parseStoredCredential, readCredential, toStoredCredential, writeCredential, type StoredCredential, } from './store.ts';
export { readJson, ReadError, type ReadClient, type ReadFailure, type ReadRequest } from './read.ts';
export { fetchQuota, QuotaAuthError, QuotaNetworkError, type QuotaClientOptions } from './quota.ts';
export { failedPlan, fetchPlan, type PlanClientOptions } from './plan.ts';
export { OAuthProtocolError, pollDeviceToken, refreshAccessToken, requestDeviceAuthorization, revokeRefreshToken, type DeviceAuthorization, type OAuthClientOptions, type TokenGrant, } from './oauth.ts';
export { DEVICE_GRANT_TYPE, OAUTH_AUDIENCE, OAUTH_CLIENT_ID, OAUTH_SCOPE, REGION_ENDPOINTS, TOKEN_REFRESH_MARGIN_MS, type Region, type RegionEndpoints, } from './constants.ts';
//# sourceMappingURL=testing.d.ts.map