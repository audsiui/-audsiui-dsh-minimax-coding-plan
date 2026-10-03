import remoteContribution from "../generated/remote.js";
import { MinimaxAccountCard } from "./MinimaxAccountCard.js";
import { MinimaxUsageBars } from "./MinimaxUsageBars.js";
import { en, zh } from "./locales.js";
const NS = 'settings.minimax';
/** Platform services required before this half activates. */
export const inject = ['slots', 'locale', 'remote', 'connection'];
/**
 * Mount the package Remote, then contribute both surfaces.
 *
 * The Remote is mounted rather than assumed present: a profile whose Host half
 * failed to load would otherwise leave a surface whose every call is
 * `remote/unavailable`, which is a far worse failure than an absent surface.
 *
 * @param ctx - the browser half's context.
 * @returns the Remote disposer, so unloading withdraws the namespace with it.
 */
export async function apply(ctx) {
    const disposeRemote = await ctx.remote.$mount(remoteContribution);
    const remote = ctx.get('remote.minimax');
    if (remote === undefined) {
        await disposeRemote();
        throw new Error('dsh-minimax-coding-plan: the mounted Remote namespace is unavailable');
    }
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'minimax: dictionaries');
    const bound = ctx.locale.bind(NS);
    const t = (key) => bound(key);
    const api = {
        loadState: async () => {
            const result = await remote.state();
            if (!result.ok)
                throw new Error(result.error.message);
            return result.value;
        },
        loadQuota: async () => {
            const result = await remote.quota();
            if (!result.ok)
                throw new Error(result.error.message);
            return result.value;
        },
        // Device authorization is a conversation, not a request: the call returns
        // once the attempt is under way and the operator approves it in a browser.
        // The surface therefore re-reads `state` on a short interval while the
        // status says it is authorizing, and stops as soon as it does not.
        startSignIn: async () => {
            const result = await remote.signIn();
            if (!result.ok)
                throw new Error(result.error.message);
        },
        signOut: async () => {
            const result = await remote.signOut();
            if (!result.ok)
                throw new Error(result.error.message);
        },
        t,
    };
    ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action',
        id: 'minimax-coding-plan',
        order: 20,
        locale: NS,
        inject: () => api,
    }, MinimaxAccountCard));
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'minimax',
        order: 30,
        label: () => t('usage.section'),
        locale: NS,
        inject: () => api,
    }, MinimaxUsageBars));
    return disposeRemote;
}
//# sourceMappingURL=index.js.map