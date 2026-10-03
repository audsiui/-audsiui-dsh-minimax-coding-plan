/**
 * The MiniMax page inside Settings.
 *
 * One `settings.section` entry owns the whole page: the account identity, the two
 * buttons, and the usage readout. That is what the slot is for — the section
 * owner receives nothing but `close`, and the entry draws its own internals.
 *
 * The card reads three separate things and keeps them visibly separate, because
 * they come from three separate places and can each fail alone: the account
 * identity and plan tier from the agent origin, the grant's own expiry from
 * local state, and the metered windows from the open platform. A read that did
 * not arrive is shown as "not reported" rather than as a blank or a zero.
 *
 * Everything visual comes from `@deepseek-ai/dsh-client-ui-primitives` plus the
 * component's own CSS Module, so the page inherits the shell's design tokens and
 * stays legible in both themes. See `MinimaxPage.module.css` for the styling
 * rules this component is held to.
 */
import { Button, Pill, SegmentedControl, StateDot, Tag, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
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

/**
 * A plan within this many days of lapsing is worth flagging rather than
 * showing as an ordinary date. Chosen to be well outside a monthly billing
 * cycle so a normally-paid plan never trips it.
 */
const PLAN_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000

/** Format an epoch instant as a local date and time, or nothing. */
function stamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return new Date(ms).toLocaleString()
}

/** Format an epoch instant as a plain local date, for a plan that lasts months. */
function date(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return new Date(ms).toLocaleDateString()
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

/**
 * The localized name for a `model_name` the service groups its windows under.
 *
 * The Host sends the raw name because a Chinese string has no locale to travel
 * with across the Remote boundary; the wording belongs here. An unrecognised
 * name is passed through untouched rather than collapsed into a bucket it may
 * not belong to.
 */
function modelLabel(model: string, t: PageProps['t']): string {
  if (model === 'general') return t('model.general')
  if (model === 'video') return t('model.video')
  return model
}

/**
 * The share of a window's own allowance that is consumed, for the bar to draw.
 *
 * The window names its own currency, so this is asked once and the surface
 * never re-derives which of the two figures is the real one.
 * @param win - the window to measure.
 * @returns 0-100, bounded.
 */
function spentPercent(win: RemoteQuotaWindow): number {
  const [used, total] = win.meter === 'count'
    ? [win.usedCount, win.totalCount]
    : [win.usedPercent, win.totalPercent]
  if (used === null || total === null || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(used / total * 100)))
}

/**
 * Escalation step for a meter's fill, as a share of the window's own total.
 *
 * Deliberately two steps rather than a traffic light: a window heading for its
 * cap is worth noticing before it runs out, and one that has run out has
 * already stopped the provider, so it is stated rather than merely coloured.
 * The step is chosen from the same ratio the bar is drawn at, so the colour and
 * the fill cannot disagree.
 */
function levelOf(spent: number): 'high' | 'spent' | undefined {
  if (spent >= 100) return 'spent'
  if (spent >= 80) return 'high'
  return undefined
}

/** Render one model's allowance window as a labelled bar. */
function UsageBar(props: { win: RemoteQuotaWindow; label: string; t: PageProps['t'] }): ReactElement {
  const { win, label, t } = props
  const name = modelLabel(win.model, t)

  if (!win.present) {
    return (
      <li className={styles.meter}>
        <div className={styles.meterHead}>
          <span className={styles.meterLabel}>{name} · {label}</span>
        </div>
        <p className={styles.empty}>{t('usage.unmetered')}</p>
      </li>
    )
  }

  const byCount = win.meter === 'count'
  // An unmetered window has nothing to draw a bar against, so it is stated and
  // not graphed. The figures are still reported below it, because the service
  // keeps sending them and they are still true.
  const spent = win.unlimited ? 0 : spentPercent(win)

  const value = win.unlimited
    ? t('usage.unlimited')
    : byCount
      ? t('usage.counts', { used: String(win.usedCount ?? 0), total: String(win.totalCount ?? 0) })
      : t('usage.percents', { used: String(win.usedPercent), total: String(win.totalPercent) })

  return (
    <li className={styles.meter} data-level={win.unlimited ? undefined : levelOf(spent)}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{name} · {label}</span>
        <span className={styles.meterValue}>{value}</span>
      </div>
      {!win.unlimited && (
        <div
          className={styles.track}
          role="meter"
          aria-valuenow={spent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${name} ${label}`}
        >
          <i className={styles.fill} style={{ width: `${spent}%` }} />
        </div>
      )}
      <div className={styles.meterFoot}>
        <span>{win.unlimited ? t('usage.unlimited') : byCount ? t('usage.byCount') : t('usage.byPercent')}</span>
        {win.remainsMs !== null && <span>{t('usage.remains')} {formatDuration(win.remainsMs)}</span>}
        {win.resetAtMs !== null && <span>{t('usage.resets')} {stamp(win.resetAtMs)}</span>}
      </div>
    </li>
  )
}

/**
 * Render the whole MiniMax page.
 * @param props - slot composition for this entry.
 * @returns the page element.
 */
export function MinimaxPage(props: PageProps): ReactElement {
  const { state, plan, quota, loading, busy, error, signIn, signOut } = useMinimaxSurface(props)
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

  // A plan inside the warning horizon is worth a different tone; one already
  // lapsed is worth a worse one. Both are read off the instant the service sent.
  const planTone: TagTone = (() => {
    if (plan?.planExpiresAtMs == null) return 'neutral'
    const left = plan.planExpiresAtMs - Date.now()
    if (left <= 0) return 'danger'
    if (left <= PLAN_EXPIRY_WARNING_MS) return 'warning'
    return 'info'
  })()

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
        <section className={styles.identity} aria-label={t('identity.title')}>
          <div className={styles.identityHead}>
            <div className={styles.identityNames}>
              <h3 className={styles.accountName}>
                {plan?.accountName ?? t('account.unknown')}
              </h3>
              {plan?.accountId != null && <p className={styles.accountId}>{plan.accountId}</p>}
            </div>
            {plan?.tier != null
              ? <Tag tone={planTone}>{plan.tier}</Tag>
              : <Tag tone="quiet">{t('plan.none')}</Tag>}
          </div>
          <dl className={styles.facts}>
            <div>
              <dt className={styles.factLabel}>{t('plan.expiresAt')}</dt>
              <dd className={styles.factValue}>{date(plan?.planExpiresAtMs) || t('plan.expiresUnknown')}</dd>
            </div>
            <div>
              <dt className={styles.factLabel}>{t('expiresAt')}</dt>
              <dd className={styles.factValue}>{stamp(state?.expiresAtMs) || t('plan.expiresUnknown')}</dd>
            </div>
            <div>
              <dt className={styles.factLabel}>{t('region')}</dt>
              <dd className={styles.factValue}>{state?.region}</dd>
            </div>
          </dl>
          {plan?.error != null && (
            <p className={styles.note}>
              <StateDot state="warning" size={8} /> {t('plan.readFailed')}: {plan.error}
            </p>
          )}
        </section>
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
              : <ul className={styles.meters}>
                  {selectedWindows.map(win => (
                    <UsageBar key={`${win.model}/${win.window}`} win={win} label={selectedLabel} t={t} />
                  ))}
                </ul>}

        {authenticated && quota?.error == null && quota != null && (
          <p className={styles.stamp}>{t('usage.updatedAt', { time: stamp(quota.fetchedAtMs) })}</p>
        )}
      </section>
    </div>
  )
}
