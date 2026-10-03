/** Wire constants for the MiniMax account origin and its Messages endpoint. */
/**
 * Public client identifier MiniMax ships in its own desktop agent. The grant
 * is a public client: there is no client secret and PKCE is the only binding.
 */
export const OAUTH_CLIENT_ID = 'mcode-public';
/** The single scope this grant authorizes. A token without it is unusable. */
export const OAUTH_SCOPE = 'agent.default';
/** Token audience selecting the agent backend rather than the open platform. */
export const OAUTH_AUDIENCE = 'agent-backend';
/** IETF device-authorization grant type used by the token endpoint. */
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
/** Regions MiniMax serves, selected by configuration. */
export const REGION_ENDPOINTS = {
    cn: {
        accountOrigin: 'https://account.minimax.cn',
        inferenceOrigin: 'https://agent.minimax.cn/mavis/api/v1/llm',
        quotaOrigin: 'https://www.minimaxi.com',
        agentOrigin: 'https://agent.minimax.cn',
    },
    en: {
        accountOrigin: 'https://account.minimax.io',
        inferenceOrigin: 'https://agent.minimax.io/mavis/api/v1/llm',
        quotaOrigin: 'https://platform.minimax.io',
        // Same host family as the region-`cn` origin, following `inferenceOrigin`
        // and `accountOrigin`. The route exists here — it answers HTTP 401 to an
        // unauthenticated request rather than 404 — but no overseas account was
        // available to read a body from, so treat the shape as unconfirmed for
        // `en` rather than as measured.
        agentOrigin: 'https://agent.minimax.io',
    },
};
/**
 * Advisory catalog used when none is configured.
 *
 * MiniMax exposes no model-discovery route on this endpoint (`/models` and
 * `/v1/models` both answer `direct_route_not_configured`), so the catalog
 * cannot be enumerated and must be declared. This default carries only the
 * wire id verified end-to-end against the device-grant token; replace it with
 * the ids your Coding Plan actually serves.
 */
export const DEFAULT_MODELS = [
    {
        id: 'MiniMax-M3.1-Flash-Preview',
        name: 'MiniMax M3.1 Flash (Preview)',
        description: 'Coding Plan model served by the MiniMax agent backend.',
    },
];
/**
 * Refresh this many milliseconds before the access token actually expires, so
 * a request never leaves the host mid-flight with a token about to lapse.
 */
export const TOKEN_REFRESH_MARGIN_MS = 120_000;
/** Fallback poll cadence when the server omits `interval` in its response. */
export const DEFAULT_POLL_INTERVAL_SEC = 5;
//# sourceMappingURL=constants.js.map