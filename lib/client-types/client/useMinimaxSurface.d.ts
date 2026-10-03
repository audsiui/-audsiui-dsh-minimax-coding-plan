import type { MinimaxSurfaceApi } from './index.ts';
import type { RemoteAccountView, RemoteQuotaView } from '../types.ts';
/** Live account and usage state, plus the two transitions. */
export interface MinimaxSurfaceState {
    readonly state: RemoteAccountView | undefined;
    readonly quota: RemoteQuotaView | undefined;
    readonly loading: boolean;
    readonly busy: boolean;
    readonly error: string | undefined;
    readonly signIn: () => void;
    readonly signOut: () => void;
}
/**
 * Subscribe to the Host's account and usage state.
 *
 * @param api - the Remote-backed loader and transitions from the slot.
 * @returns the state a component renders from.
 */
export declare function useMinimaxSurface(api: MinimaxSurfaceApi): MinimaxSurfaceState;
//# sourceMappingURL=useMinimaxSurface.d.ts.map