/**
 * The MiniMax page inside Settings.
 *
 * One `settings.section` entry owns the whole page: the account state, the two
 * buttons, and the usage readout. That is what the slot is for — the section
 * owner receives nothing but `close`, and the entry draws its own internals.
 *
 * Everything visual comes from `@deepseek-ai/dsh-client-ui-primitives`, so the
 * page inherits the shell's design tokens and stays legible in both themes. The
 * only CSS here is layout: gap and grid, never colour or radius, because those
 * are token-owned and a hard-coded value would be wrong the moment the theme
 * changes.
 */
import { Button, Pill, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useState, type ReactElement } from 'react'
import type { MinimaxSurfaceApi } from './index.ts'
import type { RemoteQuotaWindow } from '../types.ts'
import { useMinimaxSurface } from './useMinimaxSurface.ts'
import './minimax.css'

type PageProps = PropsRuntime<'settings.section'> & MinimaxSurfaceApi

/** Which allowance window the readout is showing. */
type WindowId = 'interval' | 'weekly'

/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return new Date(ms).toLocaleString()
}

/** Map the account status onto the dot's semantics. */
function dotFor(status: string): 'done' | 'warning' | 'ongoing' | 'idle' {
  if (status === 'authenticated') return 'done'
  if (status === 'authorizing') return 'ongoing'
  return 'idle'
}

/** Render one allowance window as a labelled bar. */
function UsageBar(props: { window: RemoteQuotaWindow; label: string; t: MinimaxSurfaceApi['t'] }): ReactElement {
  const { window: win, label, t } = props
  if (!win.present) return <p className="minimax-empty">{t('usage.unmetered')}</p>

  // Share of the window's own total, not of a nominal 100: a plan metered at a
  // different allowance would otherwise render as always half spent.
  const total = win.totalPercent > 0 ? win.totalPercent : 100
  const spent = win.unlimited ? 0 : Math.min(100, Math.round(win.usedPercent / total * 100))

  return (
    <div className="minimax-meter">
      <div className="minimax-meter-head">
        <span className="minimax-meter-label">{win.unlimited ? t('usage.unlimited') : label}</span>
        {!win.unlimited && <span className="minimax-meter-value">{spent}%</span>}
      </div>
      <div
        className="minimax-track"
        role="meter"
        aria-valuenow={spent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <i className={win.unlimited ? 'minimax-fill unlimited' : 'minimax-fill'} style={{ width: `${win.unlimited ? 100 : spent}%` }} />
      </div>
      <div className="minimax-meter-foot">
        {win.unlimited
          ? <span>{t('usage.unlimited')}</span>
          : <span>{t('usage.used')} {spent}% · {t('usage.left')} {Math.max(0, 100 - spent)}%</span>}
        {win.resetAtMs !== null && <span>{t('usage.resets')} {stamp(win.resetAtMs)}</span>}
      </div>
    </div>
  )
}

/**
 * Render the whole MiniMax page.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the page element.
 */
export function MinimaxPage(props: PageProps): ReactElement {
  const { state, quota, loading, busy, error, signIn, signOut } = useMinimaxSurface(props)
  const { t } = props
  const [selected, setSelected] = useState<WindowId>('weekly')

  if (loading) {
    return (
      <div className="minimax-page" aria-busy="true">
        <StateDot state="ongoing" />
      </div>
    )
  }

  const status = state?.status ?? 'signed-out'
  const authorizing = status === 'authorizing'
  const authenticated = status === 'authenticated'
  // Not named `window`: that would shadow the global the open call needs.
  const activeWindow = quota?.windows.find(w => w.id === selected)
  const options = [
    { value: 'interval' as const, label: t('usage.interval') },
    { value: 'weekly' as const, label: t('usage.weekly') },
  ]

  return (
    <div className="minimax-page" data-plugin="minimax-coding-plan">
      <header className="minimax-head">
        <div>
          <h2>{t('card.title')}</h2>
          <p className="minimax-sub">{t('card.subtitle')}</p>
        </div>
        <Pill active={authenticated}>
          <StateDot state={dotFor(status)} size={8} />
          <span className="minimax-pill-text">
            {authenticated ? t('status.authenticated') : authorizing ? t('status.authorizing') : t('status.signedOut')}
          </span>
        </Pill>
      </header>

      {authorizing && (
        <div className="minimax-device">
          <div className="minimax-device-row">
            <span className="minimax-device-label">{t('code')}</span>
            <code className="minimax-code">{state?.userCode}</code>
            {state?.verificationUri && (
              <Button variant="primary" size="sm" onClick={() => { window.open(state.verificationUri!, '_blank', 'noreferrer') }}>
                {t('openVerification')}
              </Button>
            )}
          </div>
          <p className="minimax-sub">{t('codeExpires')} {state?.expiresInSec} {t('seconds')}</p>
        </div>
      )}

      {authenticated && (
        <dl className="minimax-facts">
          <div><dt>{t('accountId')}</dt><dd>{state?.accountId ?? '—'}</dd></div>
          <div><dt>{t('region')}</dt><dd>{state?.region}</dd></div>
          <div><dt>{t('expiresAt')}</dt><dd>{stamp(state?.expiresAtMs)}</dd></div>
        </dl>
      )}

      {error !== undefined && (
        <p className="minimax-error" role="alert">
          <StateDot state="error" size={8} /> {t('error')}: {error}
        </p>
      )}

      <div className="minimax-actions">
        <Button variant="primary" onClick={signIn} disabled={busy || status !== 'signed-out'}>
          {authorizing ? t('signInBusy') : t('signIn')}
        </Button>
        <Button variant="outline" onClick={signOut} disabled={busy || !authenticated}>
          {t('signOut')}
        </Button>
      </div>

      <section className="minimax-usage">
        <div className="minimax-usage-head">
          <h3>{t('usage.section')}</h3>
          {authenticated && (
            <SegmentedControl
              id="minimax-window"
              value={selected}
              options={options}
              onChange={setSelected}
              label={t('usage.section')}
              disabled={busy}
            />
          )}
        </div>

        {!authenticated
          ? <p className="minimax-empty">
              {quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint')}
            </p>
          : quota?.error != null
            ? <p className="minimax-error"><StateDot state="error" size={8} /> {quota.error}</p>
            : activeWindow === undefined
              ? <p className="minimax-empty">{t('usage.missing')}</p>
              : <UsageBar window={activeWindow} label={options.find(o => o.value === selected)?.label ?? selected} t={t} />}

        {quota?.planLabel != null && <p className="minimax-sub">套餐 {quota.planLabel}</p>}
      </section>
    </div>
  )
}
