/**
 * MiniMax Coding Plan provider for DeepSeek Harness.
 *
 * The endpoint speaks the Anthropic Messages protocol, so this plugin reuses
 * the Messages transport from `@deepseek-ai/dsh-llm-deepseek` and only owns
 * the credential: a public-client OAuth device-authorization grant against the
 * MiniMax account origin, refreshed automatically before each use.
 */
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-authorization'
import { ACCOUNT_QUOTA_EXCEEDED_CODE, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import {
  catalogModelInfo,
  plainOptions,
  registerDeepSeekProvider,
  resolveAdapterOptions,
  type DeepSeekRequestAuth,
  type ResolvedDeepSeekOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import { MinimaxAccount } from './account.ts'
import { registerMinimaxAuthorization } from './authorization.ts'
import { MinimaxRemoteService } from './remote.ts'
import { Config, endpointsFor } from './config.ts'

export { Config, defaultCredentialsPath, endpointsFor } from './config.ts'
export { registerMinimaxAuthorization } from './authorization.ts'
export { MinimaxRemoteService, type MinimaxRemoteOptions } from './remote.ts'
export type {
  RemoteAccountStatus,
  RemoteAccountView,
  RemoteQuotaView,
  RemoteQuotaWindow,
  RemoteSignInFailure,
} from './types.ts'
export {
  fetchQuota,
  QuotaAuthError,
  QuotaNetworkError,
  type QuotaClientOptions,
  type QuotaSnapshot,
  type QuotaWindow,
} from './quota.ts'
export { GRANT_KEY, grantPayload, parseGrantPayload, readGrant, writeGrant, clearGrant } from './grant.ts'
export { MinimaxAccount, type MinimaxAccountOptions, type MinimaxAccountState } from './account.ts'
export {
  OAUTH_AUDIENCE,
  OAUTH_CLIENT_ID,
  OAUTH_SCOPE,
  REGION_ENDPOINTS,
  TOKEN_REFRESH_MARGIN_MS,
  type Region,
  type RegionEndpoints,
} from './constants.ts'
export {
  OAuthProtocolError,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceAuthorization,
  revokeRefreshToken,
  type DeviceAuthorization,
  type OAuthClientOptions,
  type TokenGrant,
} from './oauth.ts'
export { clearCredential, readCredential, writeCredential, type StoredCredential } from './store.ts'

export const name = 'llm-minimax-coding-plan'
export const inject = ['llm']

/** Provider route this plugin owns. */
const PROVIDER = 'minimax-coding-plan'

/**
 * Register the account service and the provider route backed by it.
 * @param ctx - context owning this plugin lifetime with the LLM registry injected.
 * @param config - parsed plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const region = config.region
  const endpoints = endpointsFor(region)

  // Offered as a harness authorization flow rather than only as a service
  // method: the seam owns cancellation, one-attempt-per-key, and commit
  // confirmation, and it is what the agent-facing API can drive. Injected
  // rather than read directly, so a profile without the seam still loads.
  ctx.inject(['authorization'], (child) => {
    registerMinimaxAuthorization(child, config)
  })

  const account = new MinimaxAccount(ctx, {
    endpoints,
    region,
    credentialsPath: config.credentialsPath,
    openBrowser: config.openBrowser,
  })

  // The browser surface's only route to this process. `dsh-typert-loader`
  // discovers the service through the generated `./typert` entry and the
  // Gateway dispatches `POST /api/minimax/<method>` to it, validating every
  // argument against the schema the generator derived from these signatures.
  new MinimaxRemoteService(ctx, {
    account,
    endpoints,
    region,
  })

  // `baseURL` and `models` stay volatile so a settings edit reaches the next
  // request without re-registering the adapter; read them per operation.
  const options = (): ResolvedDeepSeekOptions => {
    const plain = plainOptions(config)
    return resolveAdapterOptions({ ...plain, baseURL: plain.baseURL ?? endpoints.inferenceOrigin })
  }

  const resolveAuth = async (connection: ResolvedDeepSeekOptions): Promise<DeepSeekRequestAuth> => {
    const token = await account.resolveToken(connection.baseURL)
    if (token === undefined) {
      throw new LlmError(
        'Sign in to MiniMax to use the Coding Plan provider. Run the `llm-minimax-coding-plan` sign-in, or enable automatic sign-in.',
        'ACCOUNT_SIGN_IN_REQUIRED',
      )
    }
    return {
      headers: { Authorization: `Bearer ${token}` },
      onRequestError: async (error) => {
        if (!(error instanceof LlmError)) return error
        if (error.code === QUOTA_EXCEEDED_CODE) {
          return new LlmError(error.message, ACCOUNT_QUOTA_EXCEEDED_CODE, { ...error.failure, cause: error })
        }
        if (error.failure.status !== 401) return error
        // Drop the rejected token only while it is still the stored one, so a
        // late 401 from a superseded request cannot sign out a fresh session.
        try {
          await account.rejectToken(token)
        }
        catch (error) {
          ctx.logger.warn('minimax-coding-plan: could not retire the rejected token: %o', error)
        }
        return new LlmError(
          'The MiniMax access token was rejected. Sign in again to continue.',
          'ACCOUNT_TOKEN_INVALID',
          { ...error.failure, cause: error },
        )
      },
    }
  }

  ctx.llm.registerConfigurableProviders([{
    provider: PROVIDER,
    displayName: 'MiniMax Coding Plan',
    settingsNs: ctx.fiber.entry?.options.id ?? name,
    settingsPath: [],
  }])

  registerDeepSeekProvider(ctx, PROVIDER, {
    options,
    resolveAuth,
    providerName: 'MiniMax Coding Plan',
    discoverModels: async (provider) => {
      try {
        await resolveAuth(options())
      }
      catch (error) {
        // A signed-out account is a normal state, not a discovery failure:
        // report no models so the selector asks for sign-in instead of erroring.
        if (error instanceof LlmError && error.code === 'ACCOUNT_SIGN_IN_REQUIRED') return []
        throw error
      }
      return options().models.map(model => catalogModelInfo(provider, model))
    },
  })
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
