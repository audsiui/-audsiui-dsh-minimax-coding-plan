/** Wire constants for the MiniMax account origin and its Messages endpoint. */

/**
 * Public client identifier MiniMax ships in its own desktop agent. The grant
 * is a public client: there is no client secret and PKCE is the only binding.
 */
export const OAUTH_CLIENT_ID = 'mcode-public'

/** The single scope this grant authorizes. A token without it is unusable. */
export const OAUTH_SCOPE = 'agent.default'

/** Token audience selecting the agent backend rather than the open platform. */
export const OAUTH_AUDIENCE = 'agent-backend'

/** IETF device-authorization grant type used by the token endpoint. */
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

/** One region's account, inference, and quota origins. */
export interface RegionEndpoints {
  /** OAuth authorization server: device code, token, and revoke. */
  readonly accountOrigin: string
  /**
   * Anthropic Messages root. The adapter appends `/v1/messages`, so this
   * value must not end in `/v1` — the transport strips and re-adds it.
   */
  readonly inferenceOrigin: string
  /**
   * Open-platform origin serving `/backend/account/token_plan/*`.
   *
   * Distinct from {@link inferenceOrigin}: the same grant is accepted here,
   * but the read is a *different* trust decision, so it is listed explicitly
   * rather than folded into one "any known host" check.
   */
  readonly quotaOrigin: string
  /**
   * Agent origin serving `/v1/api/user/*` and `/matrix/api/v1/commerce/*`.
   *
   * A third distinct host, and the reason {@link inferenceOrigin} is not
   * reused for it: that value is the Messages *path* (`.../mavis/api/v1/llm`),
   * and deriving a bare origin from it by string surgery would make a routing
   * change silently become a wrong URL instead of a type error.
   *
   * Verified on `agent.minimax.cn`: `GET /v1/api/user/info` and
   * `POST /matrix/api/v1/commerce/get_membership_info` both answer under the
   * same `Authorization: Bearer` grant the quota read uses.
   */
  readonly agentOrigin: string
}

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
} as const satisfies Record<string, RegionEndpoints>

/** Configurable region names. */
export type Region = keyof typeof REGION_ENDPOINTS

/**
 * Advisory catalog used when none is configured.
 *
 * MiniMax exposes no model-discovery route on this endpoint (`/models` and
 * `/v1/models` both answer `direct_route_not_configured`), so the catalog
 * cannot be enumerated and must be declared. This default carries only the
 * wire id verified end-to-end against the device-grant token; replace it with
 * the ids your Coding Plan actually serves.
 *
 * `inputModalities` is declared rather than left to the `text` default because
 * the endpoint is the Anthropic Messages protocol and this model takes images.
 * That declaration is the whole switch: the shared transport refuses an image
 * for a route whose catalog does not list `image`
 * (`llm-deepseek: Messages image input requires a vision model and attachment
 * service`), so a text-only catalog silently projects every image into text.
 *
 * No image limits are declared. `imagePixelBudget` and `imageMaxBytes` are left
 * to the transport's own defaults — its published token grid as the projection
 * and 2 MiB as the encoded-byte ceiling — because nothing about MiniMax's side
 * of either has been measured. Declare them once it has.
 */
export const DEFAULT_MODELS = [
  {
    id: 'MiniMax-M3.1-Flash-Preview',
    name: 'MiniMax M3.1 Flash (Preview)',
    description: 'Coding Plan model served by the MiniMax agent backend.',
    inputModalities: ['text', 'image'],
  },
] satisfies ReadonlyArray<{
  id: string
  name: string
  description: string
  inputModalities: readonly ('text' | 'image')[]
}>

/**
 * Refresh this many milliseconds before the access token actually expires, so
 * a request never leaves the host mid-flight with a token about to lapse.
 */
export const TOKEN_REFRESH_MARGIN_MS = 120_000

/** Fallback poll cadence when the server omits `interval` in its response. */
export const DEFAULT_POLL_INTERVAL_SEC = 5
