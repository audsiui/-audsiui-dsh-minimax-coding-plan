/**
 * The usage readout: one metered window at a time, toggled between the short
 * `interval` window and the `weekly` one.
 *
 * Only the two windows the service actually reports are offered. There is no
 * monthly allowance on this endpoint, so there is no third tab to render — a
 * tab that always read "unmetered" would be worse than no tab, because it would
 * look like the plan had a monthly budget it was quietly burning through.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState, type ReactElement } from 'react'
import type { MinimaxSurfaceApi } from './index.ts'
import type { RemoteQuotaWindow } from '../types.ts'
import { useMinimaxSurface } from './useMinimaxSurface.ts'

type BarProps = PropsRuntime<'settings.section'> & MinimaxSurfaceApi

/** Which window the toggle is showing. */
type WindowId = 'interval' | 'weekly'

/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return new Date(ms).toLocaleString()
}

/**
 * Render the usage readout for one window.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the usage element.
 */
export function MinimaxUsageBars(props: BarProps): ReactElement {
  const { state, quota, loading } = useMinimaxSurface(props)
  const { t } = props
  const [selected, setSelected] = useState<WindowId>('weekly')

  if (loading) return <div data-plugin="minimax-coding-plan" aria-busy="true" />

  if (state?.status !== 'authenticated') {
    return (
      <div data-plugin="minimax-coding-plan">
        <p>{quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint')}</p>
      </div>
    )
  }

  const window: RemoteQuotaWindow | undefined = quota?.windows.find(w => w.id === selected)
  const tabs: readonly WindowId[] = ['interval', 'weekly']
  const label = selected === 'weekly' ? t('usage.weekly') : t('usage.interval')

  // Share of the window's own total, not of a nominal 100: a plan metered at a
  // different allowance would otherwise render as always half spent.
  const spent = window !== undefined && window.totalPercent > 0
    ? Math.min(100, Math.round(window.usedPercent / window.totalPercent * 100))
    : 0
  const left = window === undefined || window.totalPercent <= 0
    ? 0
    : Math.max(0, Math.round((window.totalPercent - window.usedPercent) / window.totalPercent * 100))

  return (
    <div data-plugin="minimax-coding-plan">
      <div role="tablist">
        {tabs.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === selected}
            onClick={() => { setSelected(id) }}
          >
            {id === 'weekly' ? t('usage.weekly') : t('usage.interval')}
          </button>
        ))}
      </div>

      {quota?.error != null && <p data-role="quota-error" role="alert">{quota.error}</p>}

      {window === undefined
        ? <p>{t('usage.missing')}</p>
        : !window.present
          ? <p>{t('usage.unmetered')}</p>
          : (
            <>
              <div data-role="usage" data-window={selected}>
                <span>{window.unlimited ? t('usage.unlimited') : label}</span>
                <div
                  role="meter"
                  aria-valuenow={spent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={label}
                >
                  <i style={{ width: `${window.unlimited ? 100 : spent}%` }} />
                </div>
                {!window.unlimited && (
                  <small>{t('usage.used')} {spent}% · {t('usage.left')} {left}%</small>
                )}
                {window.resetAtMs !== null && (
                  <small>{t('usage.resets')} {stamp(window.resetAtMs)}</small>
                )}
              </div>
              {quota?.planLabel != null && <small data-role="plan">{quota.planLabel}</small>}
            </>
          )}
    </div>
  )
}
