/**
 * Sign-in, sign-out, and plan usage, contributed to the harness settings UI.
 *
 * The browser half reaches this process through one generated contribution:
 * `src/generated/remote.ts` holds the invocation descriptors and codecs the
 * Typert generator produced from the Host `@Remote` methods, and
 * `ctx.remote.$mount()` installs it. That is the whole contract — no ad-hoc
 * transport, and nothing here can reach the Host except through a method whose
 * arguments the Gateway validated against a generated schema.
 *
 * Nothing in this file ever holds a credential. `state()` returns display
 * fields only, and the browser cannot construct a call the schema would reject.
 *
 * ## Slot vocabulary is version-bound
 *
 * `SlotMap` is populated by declaration merging from whichever package owns
 * each key, so a plugin can only fill slots its installed client packages
 * actually declare. This build fills `settings.section` and `settings.action`,
 * which every version in the supported range declares. It deliberately does not
 * reach for the more specific model-page slots: those have moved between
 * releases, and a plugin that registers against a key the running shell does
 * not declare fails the whole client fiber, not just its own entry.
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TypertRemoteContribution, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import remoteContribution from '../generated/remote.ts'
import type { RemoteAccountView, RemoteQuotaView } from '../types.ts'
import { MinimaxAccountCard } from './MinimaxAccountCard.tsx'
import { MinimaxUsageBars } from './MinimaxUsageBars.tsx'
import { en, zh, type MinimaxLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.minimax': MinimaxLocaleKey
  }
}

const NS = 'settings.minimax'

/** Platform services required before this half activates. */
export const inject = ['slots', 'locale', 'remote', 'connection']

/** The subset of the mounted namespace this surface calls. */
type MinimaxRemote = TypertRemoteNamespaceMap['minimax']

/**
 * The Remote-backed surface API, handed to each component through the slot
 * `inject` factory. Declared here rather than borrowed from a slot declaration
 * because the two slots this build fills do not declare an inject face, and the
 * component props intersect it explicitly.
 */
export interface MinimaxSurfaceApi {
  loadState: () => Promise<RemoteAccountView>
  loadQuota: () => Promise<RemoteQuotaView>
  startSignIn: () => Promise<void>
  signOut: () => Promise<void>
  t: (key: MinimaxLocaleKey) => string
}

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
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(remoteContribution as TypertRemoteContribution)
  const remote = ctx.get('remote.minimax') as MinimaxRemote | undefined
  if (remote === undefined) {
    await disposeRemote()
    throw new Error('dsh-minimax-coding-plan: the mounted Remote namespace is unavailable')
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'minimax: dictionaries')
  const bound = ctx.locale.bind(NS)
  const t = (key: MinimaxLocaleKey): string => bound(key)

  const api: MinimaxSurfaceApi = {
    loadState: async () => {
      const result = await remote.state()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    loadQuota: async () => {
      const result = await remote.quota()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    // Device authorization is a conversation, not a request: the call returns
    // once the attempt is under way and the operator approves it in a browser.
    // The surface therefore re-reads `state` on a short interval while the
    // status says it is authorizing, and stops as soon as it does not.
    startSignIn: async () => {
      const result = await remote.signIn()
      if (!result.ok) throw new Error(result.error.message)
    },
    signOut: async () => {
      const result = await remote.signOut()
      if (!result.ok) throw new Error(result.error.message)
    },
    t,
  }

  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action',
    id: 'minimax-coding-plan',
    order: 20,
    locale: NS,
    inject: () => api,
  }, MinimaxAccountCard))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'minimax',
    order: 30,
    label: () => t('usage.section'),
    locale: NS,
    inject: () => api,
  }, MinimaxUsageBars))

  return disposeRemote
}
