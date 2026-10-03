/**
 * The shared data a MiniMax surface needs, and the poll that keeps it live.
 *
 * Both surfaces read the same two records and drive the same two buttons, so
 * the fetching lives here rather than in either component: a card and a usage
 * bar that each polled independently would show the two disagreeing for as long
 * as one call was in flight.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MinimaxSurfaceApi } from './index.ts'
import type { RemoteAccountView, RemoteQuotaView } from '../types.ts'

/** Live account and usage state, plus the two transitions. */
export interface MinimaxSurfaceState {
  readonly state: RemoteAccountView | undefined
  readonly quota: RemoteQuotaView | undefined
  readonly loading: boolean
  readonly busy: boolean
  readonly error: string | undefined
  readonly signIn: () => void
  readonly signOut: () => void
}

/** How often to re-read while a device authorization is outstanding. */
const AUTHORIZING_POLL_MS = 2000

/**
 * Subscribe to the Host's account and usage state.
 *
 * The device grant takes as long as the operator takes to approve it, so while
 * the status is `authorizing` this polls `state` and stops the moment it is
 * not. The timer is cleared on unmount, so a surface that goes away mid-wait
 * leaves nothing running.
 *
 * @param api - the Remote-backed loader and transitions from the slot.
 * @returns the state a component renders from.
 */
export function useMinimaxSurface(api: MinimaxSurfaceApi): MinimaxSurfaceState {
  const [state, setState] = useState<RemoteAccountView | undefined>(undefined)
  const [quota, setQuota] = useState<RemoteQuotaView | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)

  const read = useCallback(async (): Promise<void> => {
    try {
      const next = await api.loadState()
      if (!alive.current) return
      setState(next)
      setError(undefined)
      // Usage only exists with a grant, so a signed-out account skips the read
      // instead of asking the Host to refuse it.
      if (next.status === 'authenticated') {
        const usage = await api.loadQuota()
        if (alive.current) setQuota(usage)
      }
      else {
        setQuota(undefined)
      }
    }
    catch (failure) {
      if (!alive.current) return
      setError(failure instanceof Error ? failure.message : String(failure))
    }
    finally {
      if (alive.current) setLoading(false)
    }
  }, [api.loadState, api.loadQuota])

  useEffect(() => {
    alive.current = true
    void read()
    return () => {
      alive.current = false
      if (timer.current !== undefined) clearTimeout(timer.current)
    }
  }, [read])

  // While authorizing, keep re-reading until the grant lands.
  useEffect(() => {
    if (state?.status !== 'authorizing') return
    timer.current = setTimeout(() => { void read() }, AUTHORIZING_POLL_MS)
    return () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current)
        timer.current = undefined
      }
    }
  }, [state?.status, read])

  const run = useCallback((action: () => Promise<void>) => () => {
    setBusy(true)
    setError(undefined)
    void action()
      .then(() => read())
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure))
      })
      .finally(() => { setBusy(false) })
  }, [read])

  return {
    state,
    quota,
    loading,
    busy,
    error,
    signIn: run(api.startSignIn),
    signOut: run(api.signOut),
  }
}
