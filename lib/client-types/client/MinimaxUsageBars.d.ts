/**
 * The usage readout: one metered window at a time, toggled between the short
 * `interval` window and the `weekly` one.
 *
 * Only the two windows the service actually reports are offered. There is no
 * monthly allowance on this endpoint, so there is no third tab to render — a
 * tab that always read "unmetered" would be worse than no tab, because it would
 * look like the plan had a monthly budget it was quietly burning through.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type ReactElement } from 'react';
import type { MinimaxSurfaceApi } from './index.ts';
type BarProps = PropsRuntime<'settings.section'> & MinimaxSurfaceApi;
/**
 * Render the usage readout for one window.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the usage element.
 */
export declare function MinimaxUsageBars(props: BarProps): ReactElement;
export {};
//# sourceMappingURL=MinimaxUsageBars.d.ts.map