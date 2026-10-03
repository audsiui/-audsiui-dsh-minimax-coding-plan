import { openExternal } from "./account.js";
import { endpointsFor } from "./config.js";
import { GRANT_KEY, grantPayload } from "./grant.js";
import { pollDeviceToken, requestDeviceAuthorization } from "./oauth.js";
/** Method id for the device-authorization grant; the only method this flow offers. */
const METHOD = 'device-code';
/**
 * Offer MiniMax as something the operator can authorize.
 *
 * @param ctx - plugin lifetime; the registration is withdrawn with the fiber.
 * @param config - parsed plugin configuration, read for region and browser policy.
 */
export function registerMinimaxAuthorization(ctx, config) {
    const endpoints = endpointsFor(config.region);
    ctx.authorization.registerFlow({
        key: GRANT_KEY,
        label: 'MiniMax Coding Plan',
        methods: [{ id: METHOD, label: 'Sign in with MiniMax' }],
        run: async (session) => {
            const authorization = await requestDeviceAuthorization(endpoints, {}, session.signal);
            const url = authorization.verificationUriComplete ?? authorization.verificationUri;
            session.notify({
                message: 'Approve this request in your browser to finish signing in to MiniMax.',
                url,
                code: authorization.userCode,
            });
            if (config.openBrowser !== false)
                openExternal(url);
            // The signal reaches both the poll loop and each request, so withdrawing
            // the attempt stops the wait instead of holding the key until the grant
            // expires.
            const grant = await pollDeviceToken(endpoints, authorization, {}, session.signal);
            await session.commit({ kind: 'grant', payload: grantPayload(grant, config.region) });
        },
    });
}
//# sourceMappingURL=authorization.js.map