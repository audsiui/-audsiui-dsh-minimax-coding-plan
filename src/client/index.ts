/**
 * Sign-in, sign-out, and plan usage, contributed to the harness settings UI.
 *
 * The browser half reaches this process through one generated contribution:
 * `src/generated/remote.ts` holds the invocation descriptors and codecs the
 * Typert generator produced from the Host `@Remote` methods, and
 * `ctx.remote.$mount()` installs it. `$mount` is the documented assembly entry
 * (`docs/subsystems/typert.zh.md:351,361`); each namespace becomes a traced
 * `remote.<namespace>` child service, which is what the lookup below reads
 * (`docs/api-gateway.zh.md:60`). This package is its own assembly — it owns both
 * halves — so it mounts here rather than waiting for `@deepseek-ai/dsh-api-remotes`
 * to do it. Nothing here can reach the Host except through a method whose
 * arguments the Gateway validated against a generated schema.
 *
 * Nothing in this file ever holds a credential. `state()` returns display
 * fields only, and the browser cannot construct a call the schema would reject.
 *
 * ## Slot vocabulary is version-bound
 *
 * `SlotMap` is populated by declaration merging from whichever package owns
 * each key, so a plugin can only fill slots its installed client packages
 * actually declare. This build fills `settings.section` only, which every
 * version in the supported range declares. It deliberately does not reach for
 * the more specific model-page slots: those have moved between releases, and a
 * plugin that registers against a key the running shell does not declare fails
 * the whole client fiber, not just its own entry.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TypertRemoteContribution, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import remoteContribution from '../generated/remote.ts'
import type { RemoteAccountView, RemotePlanView, RemoteQuotaView } from '../types.ts'
import { MinimaxPage } from './MinimaxPage.tsx'
import { en, zh, type MinimaxLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.minimax': MinimaxLocaleKey
  }
}

const NS = 'settings.minimax'

/**
 * Platform services required before this half activates.
 *
 * `remote` is declared because `$mount` is called on it. The `remote.minimax`
 * namespace is deliberately *not* declared: it does not exist until this same
 * function has mounted it, and an assembly that both mounts and calls owns that
 * ordering itself (`docs/api-gateway.zh.md:60` assigns the namespace dependency
 * to a business caller, not to the mounting assembly).
 */
export const inject = ['slots', 'locale', 'remote', 'connection']

/** The subset of the mounted namespace this surface calls. */
type MinimaxRemote = TypertRemoteNamespaceMap['minimax']

/**
 * The Remote-backed surface API, handed to the component through the slot
 * entry's inject face.
 *
 * `t` is not a member: it arrives separately from the registration's `locale`
 * namespace, so the component composes both shares rather than finding a
 * hand-written intersection (`docs/subsystems/slots.zh.md:73-74`).
 */
export interface MinimaxSurfaceApi {
  loadState: () => Promise<RemoteAccountView>
  loadPlan: () => Promise<RemotePlanView>
  loadQuota: () => Promise<RemoteQuotaView>
  startSignIn: () => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Unwrap one Remote outcome.
 *
 * Every generated method answers `{ ok: true, value }` or `{ ok: false, error }`,
 * so without this the failure branch is restated at each call site — five times
 * here, and once more per method for any surface added later. Written once, it
 * also gives the surface a single place where "a Host failure becomes a thrown
 * value" happens, which is what `useMinimaxSurface` splits on.
 */
function unwrap<T>(result: { readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: unknown }): T {
  if (!result.ok) throw result.error
  return result.value
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
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(remoteContribution as TypertRemoteContribution)
  const remote = ctx.get('remote.minimax') as MinimaxRemote | undefined
  if (remote === undefined) {
    await disposeRemote()
    throw new Error('dsh-minimax-coding-plan: the mounted Remote namespace is unavailable')
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'minimax: dictionaries')
  const t = ctx.locale.bind(NS)

  const api: MinimaxSurfaceApi = {
    loadState: async () => unwrap(await remote.state()),
    loadPlan: async () => unwrap(await remote.plan()),
    loadQuota: async () => unwrap(await remote.quota()),
    // Device authorization is a conversation, not a request: the call returns
    // once the attempt is under way and the operator approves it in a browser.
    // The surface therefore re-reads `state` on a short interval while the
    // status says it is authorizing, and stops as soon as it does not.
    startSignIn: async () => { unwrap(await remote.signIn()) },
    signOut: async () => { unwrap(await remote.signOut()) },
  }

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
  }, MinimaxPage))

  // The injected stylesheet is not disposed here. The client module system
  // reclaims a module's own styles when it tears the entry's fiber down
  // (`packages/client/modules/README.zh.md`), by the `data-plugin` /
  // `data-plugin-css` keys the bundle's injector writes. A disposer of our own
  // would either double-remove or race that path.
  return disposeRemote
}
