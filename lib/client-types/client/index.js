import remoteContribution from "../generated/remote.js";
import { MinimaxPage } from "./MinimaxPage.js";
import { en, zh } from "./locales.js";
const NS = 'settings.minimax';
/**
 * Platform services required before this half activates.
 *
 * `remote` is declared because `$mount` is called on it. The `remote.minimax`
 * namespace is deliberately *not* declared: it does not exist until this same
 * function has mounted it, and an assembly that both mounts and calls owns that
 * ordering itself (`docs/api-gateway.zh.md:60` assigns the namespace dependency
 * to a business caller, not to the mounting assembly).
 */
export const inject = ['slots', 'locale', 'remote', 'connection'];
/**
 * Unwrap one Remote outcome.
 *
 * Every generated method answers `{ ok: true, value }` or `{ ok: false, error }`,
 * so without this the failure branch is restated at each call site — five times
 * here, and once more per method for any surface added later. Written once, it
 * also gives the surface a single place where "a Host failure becomes a thrown
 * value" happens, which is what `useMinimaxSurface` splits on.
 */
function unwrap(result) {
    if (!result.ok)
        throw result.error;
    return result.value;
}
/**
 * Mount the package Remote, then contribute the surface.
 *
 * The Remote is mounted rather than assumed present: a profile whose Host half
 * failed to load would otherwise leave a surface whose every call is
 * `remote/unavailable`, which is a far worse failure than an absent surface.
 *
 * @param ctx - the browser half's context.
 * @returns a disposer that withdraws the namespace.
 */
export async function apply(ctx) {
    const disposeRemote = await ctx.remote.$mount(remoteContribution);
    const remote = ctx.get('remote.minimax');
    if (remote === undefined) {
        await disposeRemote();
        throw new Error('dsh-minimax-coding-plan: the mounted Remote namespace is unavailable');
    }
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'minimax: dictionaries');
    const t = ctx.locale.bind(NS);
    const api = {
        loadState: async () => unwrap(await remote.state()),
        loadPlan: async () => unwrap(await remote.plan()),
        loadQuota: async () => unwrap(await remote.quota()),
        // Device authorization is a conversation, not a request: the call returns
        // once the attempt is under way and the operator approves it in a browser.
        // The surface therefore re-reads `state` on a short interval while the
        // status says it is authorizing, and stops as soon as it does not.
        startSignIn: async () => { unwrap(await remote.signIn()); },
        signOut: async () => { unwrap(await remote.signOut()); },
    };
    // One section, and it is the whole page. `settings.section` is the only
    // settings seat whose entry owns its own internals: the owner hands it
    // nothing but `close`, and the shell renders the entry into the content
    // column with its own label in the nav. `settings.action` is deliberately not
    // used — that is the header strip before the Close button, which is sized
    // for a one-line control, not for an account panel.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'minimax',
        order: 30,
        label: () => t('usage.section'),
        locale: NS,
        inject: () => api,
    }, MinimaxPage));
    // The injected stylesheet is not disposed here. The client module system
    // reclaims a module's own styles when it tears the entry's fiber down
    // (`packages/client/modules/README.zh.md`), by the `data-plugin` /
    // `data-plugin-css` keys the bundle's injector writes. A disposer of our own
    // would either double-remove or race that path.
    return disposeRemote;
}
//# sourceMappingURL=index.js.map