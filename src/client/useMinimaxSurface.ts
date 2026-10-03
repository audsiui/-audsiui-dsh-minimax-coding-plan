/**
 * The shared data a MiniMax surface needs, and the poll that keeps it live.
 *
 * Both surfaces read the same two records and drive the same two buttons, so the
 * fetching lives here rather than in either component: a card and a usage bar
 * that each polled independently would show the two disagreeing for as long as
 * one call was in flight.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isRemoteFailure } from './isRemoteFailure.ts'
import type { MinimaxSurfaceApi } from './index.ts'
import type { RemoteAccountView, RemotePlanView, RemoteQuotaView } from '../types.ts'

/** Live account and usage state, plus the two transitions. */
export interface MinimaxSurfaceState {
  readonly state: RemoteAccountView | undefined
  readonly plan: RemotePlanView | undefined
  readonly quota: RemoteQuotaView | undefined
  readonly loading: boolean
  readonly busy: boolean
  readonly error: string | undefined
  readonly signIn: () => void
  readonly signOut: () => void
}

/** How often to re-read while a sign-in is in flight. */
const POLL_INTERVAL_MS = 2000

/**
 * How long polling continues after the last sign-in press.
 *
 * The device grant takes as long as the operator takes to approve it, and the
 * Host's code request is asynchronous — so a read taken the instant the button
 * is pressed reports the *pre-attempt* state, not `authorizing`. Gating the poll
 * on having observed `authorizing` therefore loses the race: the read wins, the
 * gate never opens, and the grant the operator approves in the browser lands
 * with nothing re-reading for it. The page sits on "signed out" indefinitely.
 *
 * So the poll runs for a bounded window after a press and stops as soon as it
 * sees the account authenticated. The window is the operator's, not the server's
 * — the code is valid far longer than this — and it is a backstop, not the
 * mechanism: it is cleared on success and expires on its own otherwise.
 */
const POLL_WINDOW_MS = 10 * 60 * 1_000

/**
 * Subscribe to the Host's account and usage state.
 *
 * @param api - the Remote-backed loader and transitions from the slot.
 * @returns the state a component renders from.
 */
export function useMinimaxSurface(api: MinimaxSurfaceApi): MinimaxSurfaceState {
  const [state, setState] = useState<RemoteAccountView | undefined>(undefined)
  const [plan, setPlan] = useState<RemotePlanView | undefined>(undefined)
  const [quota, setQuota] = useState<RemoteQuotaView | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [polling, setPolling] = useState(false)
  const alive = useRef(true)

  const read = useCallback(async (): Promise<void> => {
    try {
      const next = await api.loadState()
      if (!alive.current) return
      setState(next)
      setError(undefined)
      // Usage only exists with a grant, so a signed-out account skips the reads
      // instead of asking the Host to refuse them.
      if (next.status === 'authenticated') {
        // The account and plan reads are independent of the usage read and of
        // each other, so all three are in flight together. Awaiting them in
        // sequence would make the card appear in three steps; awaiting them
        // with `all` would let one rejection discard the other two answers.
        // A settled read is never a rejected one: each Remote method reports
        // its own failure inside the record it returns, and only a wiring
        // defect rejects — which `catch` below already treats as fatal.
        const [account, usage] = await Promise.all([api.loadPlan(), api.loadQuota()])
        if (alive.current) {
          setPlan(account)
          setQuota(usage)
          // Nothing left to wait for; stop the window early.
          setPolling(false)
        }
      }
      else {
        setPlan(undefined)
        setQuota(undefined)
      }
    }
    catch (failure) {
      // `isRemoteFailure` is the one predicate that separates a Host or Gateway
      // failure from a local defect (`docs/cookbook/adding-a-remote-api.zh.md:109`).
      // A Remote call folds carrier trouble into the error branch and rejects
      // only on an assembly fault, so anything it rejects here is a wiring bug
      // this package shipped — it keeps travelling up instead of being painted
      // on the page as a network error the operator cannot act on.
      if (!isRemoteFailure(failure)) throw failure
      if (!alive.current) return
      setError(failure.message)
    }
    finally {
      if (alive.current) setLoading(false)
    }
  }, [api.loadState, api.loadQuota])

  useEffect(() => {
    alive.current = true
    void read()
    return () => { alive.current = false }
  }, [read])

  // The poll itself. Unconditional while the window is open, so it does not
  // depend on catching an intermediate state; an interval rather than a chained
  // timeout so a slow or failed read cannot stall the next tick.
  useEffect(() => {
    if (!polling) return
    const tick = setInterval(() => { void read() }, POLL_INTERVAL_MS)
    const cap = setTimeout(() => setPolling(false), POLL_WINDOW_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(cap)
    }
  }, [polling, read])

  // A surface that mounts into an attempt already running — a remount while the
  // operator is still at the verification page — has to join the same window.
  useEffect(() => {
    if (state?.status === 'authorizing') setPolling(true)
  }, [state?.status])

  const run = useCallback((action: () => Promise<void>, opensWindow: boolean) => () => {
    setBusy(true)
    setError(undefined)
    if (opensWindow) setPolling(true)
    void action()
      .then(() => read())
      .catch((failure: unknown) => {
        // Same split as `read`: a Host code becomes a message, a local defect
        // stays a defect.
        if (!isRemoteFailure(failure)) throw failure
        setError(failure.message)
      })
      .finally(() => { setBusy(false) })
  }, [read])

  return {
    state,
    plan,
    quota,
    loading,
    busy,
    error,
    signIn: run(api.startSignIn, true),
    signOut: run(api.signOut, false),
  }
}
