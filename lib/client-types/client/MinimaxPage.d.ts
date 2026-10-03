import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactElement } from 'react';
import type { MinimaxSurfaceApi } from './index.ts';
/**
 * The slot composition, derived rather than re-spelled: owner props, this
 * entry's injected Remote API, and the `t` that the registration's `locale`
 * namespace contributes.
 */
type PageProps = ComposedProps<'settings.section', 'minimax', never, undefined, MinimaxSurfaceApi, never, 'settings.minimax'>;
/**
 * Render the whole MiniMax page.
 * @param props - slot composition for this entry.
 * @returns the page element.
 */
export declare function MinimaxPage(props: PageProps): ReactElement;
export {};
//# sourceMappingURL=MinimaxPage.d.ts.map