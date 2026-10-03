import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { RemoteAccountView, RemoteQuotaView } from '../types.ts';
import { type MinimaxLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'settings.minimax': MinimaxLocaleKey;
    }
}
/** Platform services required before this half activates. */
export declare const inject: string[];
/**
 * The Remote-backed surface API, handed to each component through the slot
 * `inject` factory. Declared here rather than borrowed from a slot declaration
 * because the two slots this build fills do not declare an inject face, and the
 * component props intersect it explicitly.
 */
export interface MinimaxSurfaceApi {
    loadState: () => Promise<RemoteAccountView>;
    loadQuota: () => Promise<RemoteQuotaView>;
    startSignIn: () => Promise<void>;
    signOut: () => Promise<void>;
    t: (key: MinimaxLocaleKey) => string;
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
export declare function apply(ctx: ClientContext): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map