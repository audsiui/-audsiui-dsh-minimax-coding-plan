import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactElement } from 'react';
import type { MinimaxSurfaceApi } from './index.ts';
import './minimax.css';
type PageProps = PropsRuntime<'settings.section'> & MinimaxSurfaceApi;
/**
 * Render the whole MiniMax page.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the page element.
 */
export declare function MinimaxPage(props: PageProps): ReactElement;
export {};
//# sourceMappingURL=MinimaxPage.d.ts.map