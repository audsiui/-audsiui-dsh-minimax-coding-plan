/**
 * The account card: status, the two buttons, and the device code while a
 * sign-in is outstanding.
 *
 * Registered at `settings.action`, so it sits in the settings action row
 * alongside the shell's own controls rather than in a page of its own.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactElement } from 'react'
import type { MinimaxSurfaceApi } from './index.ts'
import { useMinimaxSurface } from './useMinimaxSurface.ts'

type CardProps = PropsRuntime<'settings.action'> & MinimaxSurfaceApi

/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return new Date(ms).toLocaleString()
}

/**
 * Render the MiniMax account controls.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the card element.
 */
export function MinimaxAccountCard(props: CardProps): ReactElement {
  const { state, loading, busy, error, signIn, signOut } = useMinimaxSurface(props)
  const { t } = props
  if (loading) return <div data-plugin="minimax-coding-plan" aria-busy="true" />

  const status = state?.status ?? 'signed-out'
  const statusKey = status === 'authenticated'
    ? 'status.authenticated'
    : status === 'authorizing' ? 'status.authorizing' : 'status.signedOut'

  return (
    <div data-plugin="minimax-coding-plan">
      <div data-role="status" data-status={status}>
        <strong>{t('card.title')}</strong>
        <span>{t(statusKey)}</span>
      </div>

      {status === 'authorizing' && (
        <div data-role="device-code">
          <span>{t('code')}</span>
          <code>{state?.userCode}</code>
          {state?.verificationUri && (
            <a href={state.verificationUri} target="_blank" rel="noreferrer">
              {t('openVerification')}
            </a>
          )}
          <small>
            {t('codeExpires')} {state?.expiresInSec} {t('seconds')}
          </small>
        </div>
      )}

      {status === 'authenticated' && (
        <dl data-role="account">
          <dt>{t('accountId')}</dt>
          <dd>{state?.accountId ?? '—'}</dd>
          <dt>{t('expiresAt')}</dt>
          <dd>{stamp(state?.expiresAtMs)}</dd>
          <dt>{t('region')}</dt>
          <dd>{state?.region}</dd>
        </dl>
      )}

      {error !== undefined && <p data-role="error" role="alert">{t('error')}: {error}</p>}

      <div data-role="actions">
        <button type="button" onClick={signIn} disabled={busy || status !== 'signed-out'}>
          {status === 'authorizing' ? t('signInBusy') : t('signIn')}
        </button>
        <button type="button" onClick={signOut} disabled={busy || status !== 'authenticated'}>
          {t('signOut')}
        </button>
      </div>
    </div>
  )
}
