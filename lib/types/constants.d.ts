/** Wire constants for the MiniMax account origin and its Messages endpoint. */
/**
 * Public client identifier MiniMax ships in its own desktop agent. The grant
 * is a public client: there is no client secret and PKCE is the only binding.
 */
export declare const OAUTH_CLIENT_ID = "mcode-public";
/** The single scope this grant authorizes. A token without it is unusable. */
export declare const OAUTH_SCOPE = "agent.default";
/** Token audience selecting the agent backend rather than the open platform. */
export declare const OAUTH_AUDIENCE = "agent-backend";
/** IETF device-authorization grant type used by the token endpoint. */
export declare const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
/** One region's account, inference, and quota origins. */
export interface RegionEndpoints {
    /** OAuth authorization server: device code, token, and revoke. */
    readonly accountOrigin: string;
    /**
     * Anthropic Messages root. The adapter appends `/v1/messages`, so this
     * value must not end in `/v1` — the transport strips and re-adds it.
     */
    readonly inferenceOrigin: string;
    /**
     * Open-platform origin serving `/backend/account/token_plan/*`.
     *
     * Distinct from {@link inferenceOrigin}: the same grant is accepted here,
     * but the read is a *different* trust decision, so it is listed explicitly
     * rather than folded into one "any known host" check.
     */
    readonly quotaOrigin: string;
}
/** Regions MiniMax serves, selected by configuration. */
export declare const REGION_ENDPOINTS: {
    readonly cn: {
        readonly accountOrigin: "https://account.minimax.cn";
        readonly inferenceOrigin: "https://agent.minimax.cn/mavis/api/v1/llm";
        readonly quotaOrigin: "https://www.minimaxi.com";
    };
    readonly en: {
        readonly accountOrigin: "https://account.minimax.io";
        readonly inferenceOrigin: "https://agent.minimax.io/mavis/api/v1/llm";
        readonly quotaOrigin: "https://platform.minimax.io";
    };
};
/** Configurable region names. */
export type Region = keyof typeof REGION_ENDPOINTS;
/**
 * Advisory catalog used when none is configured.
 *
 * MiniMax exposes no model-discovery route on this endpoint (`/models` and
 * `/v1/models` both answer `direct_route_not_configured`), so the catalog
 * cannot be enumerated and must be declared. This default carries only the
 * wire id verified end-to-end against the device-grant token; replace it with
 * the ids your Coding Plan actually serves.
 */
export declare const DEFAULT_MODELS: readonly [{
    readonly id: "MiniMax-M3.1-Flash-Preview";
    readonly name: "MiniMax M3.1 Flash (Preview)";
    readonly description: "Coding Plan model served by the MiniMax agent backend.";
}];
/**
 * Refresh this many milliseconds before the access token actually expires, so
 * a request never leaves the host mid-flight with a token about to lapse.
 */
export declare const TOKEN_REFRESH_MARGIN_MS = 120000;
/** Fallback poll cadence when the server omits `interval` in its response. */
export declare const DEFAULT_POLL_INTERVAL_SEC = 5;
//# sourceMappingURL=constants.d.ts.map