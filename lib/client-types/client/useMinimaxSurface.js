/**
 * The shared data a MiniMax surface needs, and the poll that keeps it live.
 *
 * Both surfaces read the same two records and drive the same two buttons, so the
 * fetching lives here rather than in either component: a card and a usage bar
 * that each polled independently would show the two disagreeing for as long as
 * one call was in flight.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
/** How often to re-read while a sign-in is in flight. */
const POLL_INTERVAL_MS = 2000;
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
const POLL_WINDOW_MS = 10 * 60 * 1_000;
/**
 * Subscribe to the Host's account and usage state.
 *
 * @param api - the Remote-backed loader and transitions from the slot.
 * @returns the state a component renders from.
 */
export function useMinimaxSurface(api) {
    const [state, setState] = useState(undefined);
    const [quota, setQuota] = useState(undefined);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(undefined);
    const [polling, setPolling] = useState(false);
    const alive = useRef(true);
    const read = useCallback(async () => {
        try {
            const next = await api.loadState();
            if (!alive.current)
                return;
            setState(next);
            setError(undefined);
            // Usage only exists with a grant, so a signed-out account skips the read
            // instead of asking the Host to refuse it.
            if (next.status === 'authenticated') {
                const usage = await api.loadQuota();
                if (alive.current) {
                    setQuota(usage);
                    // Nothing left to wait for; stop the window early.
                    setPolling(false);
                }
            }
            else {
                setQuota(undefined);
            }
        }
        catch (failure) {
            if (!alive.current)
                return;
            setError(failure instanceof Error ? failure.message : String(failure));
        }
        finally {
            if (alive.current)
                setLoading(false);
        }
    }, [api.loadState, api.loadQuota]);
    useEffect(() => {
        alive.current = true;
        void read();
        return () => { alive.current = false; };
    }, [read]);
    // The poll itself. Unconditional while the window is open, so it does not
    // depend on catching an intermediate state; an interval rather than a chained
    // timeout so a slow or failed read cannot stall the next tick.
    useEffect(() => {
        if (!polling)
            return;
        const tick = setInterval(() => { void read(); }, POLL_INTERVAL_MS);
        const cap = setTimeout(() => setPolling(false), POLL_WINDOW_MS);
        return () => {
            clearInterval(tick);
            clearTimeout(cap);
        };
    }, [polling, read]);
    // A surface that mounts into an attempt already running — a remount while the
    // operator is still at the verification page — has to join the same window.
    useEffect(() => {
        if (state?.status === 'authorizing')
            setPolling(true);
    }, [state?.status]);
    const run = useCallback((action, opensWindow) => () => {
        setBusy(true);
        setError(undefined);
        if (opensWindow)
            setPolling(true);
        void action()
            .then(() => read())
            .catch((failure) => {
            setError(failure instanceof Error ? failure.message : String(failure));
        })
            .finally(() => { setBusy(false); });
    }, [read]);
    return {
        state,
        quota,
        loading,
        busy,
        error,
        signIn: run(api.startSignIn, true),
        signOut: run(api.signOut, false),
    };
}
//# sourceMappingURL=useMinimaxSurface.js.map