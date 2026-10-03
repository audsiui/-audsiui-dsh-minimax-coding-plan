/**
 * The account card: status, the two buttons, and the device code while a
 * sign-in is outstanding.
 *
 * Registered at `settings.action`, so it sits in the settings action row
 * alongside the shell's own controls rather than in a page of its own.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ReactElement } from 'react';
import type { MinimaxSurfaceApi } from './index.ts';
type CardProps = PropsRuntime<'settings.action'> & MinimaxSurfaceApi;
/**
 * Render the MiniMax account controls.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the card element.
 */
export declare function MinimaxAccountCard(props: CardProps): ReactElement;
export {};
//# sourceMappingURL=MinimaxAccountCard.d.ts.map