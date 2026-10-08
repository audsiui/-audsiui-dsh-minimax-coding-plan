/**
 * How the MiniMax credential becomes an authenticated Messages request.
 *
 * This is the plugin's *provider policy*, separated from `apply()` so that
 * assembling the plugin and deciding what a request should carry with it are two
 * different readings of the same file. It was inline in the composition root
 * before, where it was a closure over `ctx` and `account` with no name — which
 * made it reachable only by running the whole plugin, even though every rule in
 * it is a decision someone might reasonably want to change or argue with.
 *
 * Five decisions live here, and none of them is assembly:
 *
 * 1. **The grant travels as `Authorization: Bearer`.** There is no API key on
 *    this route; the account service is the only source of a token.
 * 2. **No token means a named failure, not a 401.** `ACCOUNT_SIGN_IN_REQUIRED` is
 *    what the surface keys "offer sign-in" off, so it has to be distinguishable
 *    from the endpoint having rejected something.
 * 3. **A quota rejection is re-labelled.** The Messages transport reports the
 *    provider's own `ACCOUNT_QUOTA_EXCEEDED` code; remapping it here keeps the
 *    transport's vocabulary intact for everyone else using it.
 * 4. **A 401 retires only the token that was actually rejected.** A burst of
 *    parallel turns can hold several in flight, and a late 401 from a
 *    superseded one must not sign out the session that replaced it.
 * 5. **Being signed out is not a discovery failure.** The catalog is declared,
 *    not enumerated, so a signed-out account reports no models and the selector
 *    asks for sign-in — instead of an error the operator can do nothing about.
 *
 * `options()` is a function rather than a value on purpose: `baseURL` and
 * `models` are volatile configuration, so a settings edit has to reach the next
 * request without re-registering the adapter.
 */
import type { Context } from '@deepseek-ai/cordis'
import { ACCOUNT_QUOTA_EXCEEDED_CODE, LlmError, QUOTA_EXCEEDED_CODE, type LlmModelInfo } from '@deepseek-ai/dsh-llm'
import {
  catalogModelInfo,
  plainOptions,
  resolveAdapterOptions,
  type DeepSeekRequestAuth,
  type ResolvedDeepSeekOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import type { MinimaxAccountReader } from './account.ts'
import type { Config } from './config.ts'
import type { RegionEndpoints } from './constants.ts'

/**
 * The three collaborators `registerDeepSeekProvider` takes, named.
 *
 * They are grouped because they share a lifetime: all three are built from the
 * one account and the one configuration, and they are meaningless apart from it.
 */
export interface MinimaxProviderBinding {
  /** Resolved Messages options for the current configuration. */
  options: () => ResolvedDeepSeekOptions
  /** The grant to attach to one request, plus how to react to its rejection. */
  resolveAuth: (connection: ResolvedDeepSeekOptions) => Promise<DeepSeekRequestAuth>
  /** The catalog, or nothing while the account has no grant. */
  discoverModels: (provider: string) => Promise<LlmModelInfo[]>
}

/**
 * Bind the credential to the Messages transport.
 *
 * @param ctx - context the provider is registered in; used only for logging.
 * @param account - the credential the requests authenticate with.
 * @param config - parsed plugin configuration.
 * @param endpoints - the configured region's origins.
 * @returns the three collaborators the provider registration takes.
 */
export function createMinimaxProviderBinding(
  ctx: Context,
  account: MinimaxAccountReader,
  config: Config,
  endpoints: RegionEndpoints,
): MinimaxProviderBinding {
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

  const discoverModels = async (provider: string): Promise<LlmModelInfo[]> => {
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
  }

  return { options, resolveAuth, discoverModels }
}
