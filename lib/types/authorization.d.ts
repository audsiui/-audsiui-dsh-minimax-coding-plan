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
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.ts';
/**
 * Offer MiniMax as something the operator can authorize.
 *
 * @param ctx - plugin lifetime; the registration is withdrawn with the fiber.
 * @param config - parsed plugin configuration, read for region and browser policy.
 */
export declare function registerMinimaxAuthorization(ctx: Context, config: Config): void;
//# sourceMappingURL=authorization.d.ts.map