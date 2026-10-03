/**
 * The MiniMax page inside Settings.
 *
 * One `settings.section` entry owns the whole page: the account state, the two
 * buttons, and the usage readout. That is what the slot is for — the section
 * owner receives nothing but `close`, and the entry draws its own internals.
 *
 * Everything visual comes from `@deepseek-ai/dsh-client-ui-primitives` plus the
 * component's own CSS Module, so the page inherits the shell's design tokens and
 * stays legible in both themes. See `MinimaxPage.module.css` for the styling
 * rules this component is held to.
 */
import { Button, Pill, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { useState, type ReactElement } from 'react'
import type { RemoteQuotaWindow } from '../types.ts'
import type { MinimaxSurfaceApi } from './index.ts'
import styles from './MinimaxPage.module.css'
import { useMinimaxSurface } from './useMinimaxSurface.ts'

/**
 * The slot composition, derived rather than re-spelled: owner props, this
 * entry's injected Remote API, and the `t` that the registration's `locale`
 * namespace contributes.
 */
type PageProps = ComposedProps<
  'settings.section',
  'minimax',
  never,
  undefined,
  MinimaxSurfaceApi,
  never,
  'settings.minimax'
>

/** Which allowance window the readout is showing. */
type WindowId = 'interval' | 'weekly'

/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return new Date(ms).toLocaleString()
}

/**
 * Format a remaining duration the way the service counts it: milliseconds.
 * The service reports these as plain numbers (`remains_time`, `weekly_remains_time`),
 * not as an instant, so there is nothing to convert against a clock.
 * @param ms - duration in milliseconds.
 * @returns a short human duration.
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 48) return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Map the account status onto the dot's semantics. */
function dotFor(status: string): 'done' | 'warning' | 'ongoing' | 'idle' {
  if (status === 'authenticated') return 'done'
  if (status === 'authorizing') return 'ongoing'
  return 'idle'
}

/** Render one model's allowance window as a labelled bar. */
function UsageBar(props: { win: RemoteQuotaWindow; label: string; t: PageProps['t'] }): ReactElement {
  const { win, label, t } = props
  if (!win.present) {
    return (
      <div className={styles.meter}>
        <div className={styles.meterHead}>
          <span className={styles.meterLabel}>{win.model} · {label}</span>
        </div>
        <p className={styles.empty}>{t('usage.unmetered')}</p>
      </div>
    )
  }

  // Share of the window's own total, not of a nominal 100: this plan's weekly
  // window is metered at 150%, and a bar computed against 100 would show it
  // permanently two-thirds spent.
  const total = win.totalPercent > 0 ? win.totalPercent : 100
  const spent = Math.min(100, Math.max(0, Math.round(win.usedPercent / total * 100)))

  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{win.model} · {label}</span>
        <span className={styles.meterValue}>{spent}%</span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-valuenow={spent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${win.model} ${label}`}
      >
        <i className={styles.fill} style={{ width: `${spent}%` }} />
      </div>
      <div className={styles.meterFoot}>
        <span>{t('usage.used')} {win.usedPercent}% / {win.totalPercent}%</span>
        {win.remainsMs !== null && <span>{t('usage.remains')} {formatDuration(win.remainsMs)}</span>}
        {win.resetAtMs !== null && <span>{t('usage.resets')} {stamp(win.resetAtMs)}</span>}
      </div>
    </div>
  )
}

/**
 * Render the whole MiniMax page.
 * @param props - slot composition for this entry.
 * @returns the page element.
 */
export function MinimaxPage(props: PageProps): ReactElement {
  const { state, quota, loading, busy, error, signIn, signOut } = useMinimaxSurface(props)
  const { t } = props
  const [selected, setSelected] = useState<WindowId>('weekly')

  if (loading) {
    return (
      <div className={styles.page} aria-busy="true">
        <StateDot state="ongoing" />
      </div>
    )
  }

  const status = state?.status ?? 'signed-out'
  const authorizing = status === 'authorizing'
  const authenticated = status === 'authenticated'
  // The service meters each model family separately, so the chosen window is a
  // filter rather than a single row: one bar per model that reports it.
  const options = [
    { value: 'interval' as const, label: t('usage.interval') },
    { value: 'weekly' as const, label: t('usage.weekly') },
  ]
  const selectedLabel = options.find(option => option.value === selected)?.label ?? selected
  const selectedWindows = (quota?.windows ?? []).filter(win => win.window === selected)

  return (
    <div className={styles.page} data-plugin="minimax-coding-plan">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{t('card.title')}</h2>
          <p className={styles.sub}>{t('card.subtitle')}</p>
        </div>
        <Pill active={authenticated}>
          <StateDot state={dotFor(status)} size={8} />
          <span className={styles.pillText}>
            {authenticated ? t('status.authenticated') : authorizing ? t('status.authorizing') : t('status.signedOut')}
          </span>
        </Pill>
      </header>

      {authorizing && (
        <div className={styles.device}>
          <div className={styles.deviceRow}>
            <span className={styles.deviceLabel}>{t('code')}</span>
            <code className={styles.code}>{state?.userCode}</code>
            {state?.verificationUri && (
              <Button variant="primary" size="sm" onClick={() => { window.open(state.verificationUri!, '_blank', 'noreferrer') }}>
                {t('openVerification')}
              </Button>
            )}
          </div>
          <p className={styles.sub}>{t('codeExpires')} {state?.expiresInSec} {t('seconds')}</p>
        </div>
      )}

      {authenticated && (
        <dl className={styles.facts}>
          <div><dt className={styles.factLabel}>{t('accountId')}</dt><dd className={styles.factValue}>{state?.accountId ?? '—'}</dd></div>
          <div><dt className={styles.factLabel}>{t('region')}</dt><dd className={styles.factValue}>{state?.region}</dd></div>
          <div><dt className={styles.factLabel}>{t('expiresAt')}</dt><dd className={styles.factValue}>{stamp(state?.expiresAtMs)}</dd></div>
        </dl>
      )}

      {error !== undefined && (
        <p className={styles.error} role="alert">
          <StateDot state="error" size={8} /> {t('error')}: {error}
        </p>
      )}

      <div className={styles.actions}>
        <Button variant="primary" onClick={signIn} disabled={busy || status !== 'signed-out'}>
          {authorizing ? t('signInBusy') : t('signIn')}
        </Button>
        <Button variant="outline" onClick={signOut} disabled={busy || !authenticated}>
          {t('signOut')}
        </Button>
      </div>

      <section className={styles.usage}>
        <div className={styles.usageHead}>
          <h3 className={styles.usageTitle}>{t('usage.section')}</h3>
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
          ? <p className={styles.empty}>
              {quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint')}
            </p>
          : quota?.error != null
            ? <p className={styles.error}><StateDot state="error" size={8} /> {quota.error}</p>
            : selectedWindows.length === 0
              ? <p className={styles.empty}>{t('usage.missing')}</p>
              : selectedWindows.map(win => (
                <UsageBar key={`${win.model}/${win.window}`} win={win} label={selectedLabel} t={t} />
              ))}
      </section>
    </div>
  )
}
