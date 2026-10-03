import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { RemoteAccountView, RemoteQuotaView } from '../types.ts';
import { type MinimaxLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'settings.minimax': MinimaxLocaleKey;
    }
}
/**
 * Platform services required before this half activates.
 *
 * `remote` is declared because `$mount` is called on it. The `remote.minimax`
 * namespace is deliberately *not* declared: it does not exist until this same
 * function has mounted it, and an assembly that both mounts and calls owns that
 * ordering itself (`docs/api-gateway.zh.md:60` assigns the namespace dependency
 * to a business caller, not to the mounting assembly).
 */
export declare const inject: string[];
/**
 * The Remote-backed surface API, handed to the component through the slot
 * entry's inject face.
 *
 * `t` is not a member: it arrives separately from the registration's `locale`
 * namespace, so the component composes both shares rather than finding a
 * hand-written intersection (`docs/subsystems/slots.zh.md:73-74`).
 */
export interface MinimaxSurfaceApi {
    loadState: () => Promise<RemoteAccountView>;
    loadQuota: () => Promise<RemoteQuotaView>;
    startSignIn: () => Promise<void>;
    signOut: () => Promise<void>;
}
/**
 * Mount the package Remote, then contribute the surface.
 *
 * The Remote is mounted rather than assumed present: a profile whose Host half
 * failed to load would otherwise leave a surface whose every call is
 * `remote/unavailable`, which is a far worse failure than an absent surface.
 *
 * @param ctx - the browser half's context.
 * @returns a disposer that withdraws the namespace and the stylesheet.
 */
export declare function apply(ctx: ClientContext): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map