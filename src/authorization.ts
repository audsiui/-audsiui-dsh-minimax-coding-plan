/**
 * The MiniMax grant as a harness authorization flow.
 *
 * `ctx.authorization` is the seam the harness documents for exactly this case:
 * a credential nobody can supply from configuration alone, because getting it
 * takes a conversation with a human. The seam owns the conversation and the
 * lifecycle — one attempt per key, cancellation, commit confirmation — while
 * this file owns only the protocol, which is the split its own documentation
 * asks for. Registering here rather than calling `MinimaxAccount.signIn()`
 * from a surface is what makes the attempt cancellable and observable.
 *
 * The flow reports the verification page through `session.notify`, whose
 * `url` and `code` fields are what a surface renders, and opens the page
 * itself as well: a headless surface drops the notice, and the device flow
 * still has to be finishable.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-authorization'
import { openExternal } from './account.ts'
import type { Config } from './config.ts'
import { endpointsFor } from './config.ts'
import { GRANT_KEY, grantPayload } from './grant.ts'
import { pollDeviceToken, requestDeviceAuthorization } from './oauth.ts'

/** Method id for the device-authorization grant; the only method this flow offers. */
const METHOD = 'device-code'

/**
 * Offer MiniMax as something the operator can authorize.
 *
 * @param ctx - plugin lifetime; the registration is withdrawn with the fiber.
 * @param config - parsed plugin configuration, read for region and browser policy.
 */
export function registerMinimaxAuthorization(ctx: Context, config: Config): void {
  const endpoints = endpointsFor(config.region)

  ctx.authorization.registerFlow({
    key: GRANT_KEY,
    label: 'MiniMax Coding Plan',
    methods: [{ id: METHOD, label: 'Sign in with MiniMax' }],
    run: async (session) => {
      const authorization = await requestDeviceAuthorization(endpoints, {}, session.signal)
      const url = authorization.verificationUriComplete ?? authorization.verificationUri
      session.notify({
        message: 'Approve this request in your browser to finish signing in to MiniMax.',
        url,
        code: authorization.userCode,
      })
      if (config.openBrowser !== false) openExternal(url)

      // The signal reaches both the poll loop and each request, so withdrawing
      // the attempt stops the wait instead of holding the key until the grant
      // expires.
      const grant = await pollDeviceToken(endpoints, authorization, {}, session.signal)
      await session.commit({ kind: 'grant', payload: grantPayload(grant, config.region) })
    },
  })
}
