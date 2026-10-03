import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Button, Pill, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { useState } from 'react';
import { useMinimaxSurface } from "./useMinimaxSurface.js";
import './minimax.css';
/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms) {
    if (ms === null || ms === undefined)
        return '';
    return new Date(ms).toLocaleString();
}
/** Map the account status onto the dot's semantics. */
function dotFor(status) {
    if (status === 'authenticated')
        return 'done';
    if (status === 'authorizing')
        return 'ongoing';
    return 'idle';
}
/** Render one allowance window as a labelled bar. */
function UsageBar(props) {
    const { window: win, label, t } = props;
    if (!win.present)
        return _jsx("p", { className: "minimax-empty", children: t('usage.unmetered') });
    // Share of the window's own total, not of a nominal 100: a plan metered at a
    // different allowance would otherwise render as always half spent.
    const total = win.totalPercent > 0 ? win.totalPercent : 100;
    const spent = win.unlimited ? 0 : Math.min(100, Math.round(win.usedPercent / total * 100));
    return (_jsxs("div", { className: "minimax-meter", children: [_jsxs("div", { className: "minimax-meter-head", children: [_jsx("span", { className: "minimax-meter-label", children: win.unlimited ? t('usage.unlimited') : label }), !win.unlimited && _jsxs("span", { className: "minimax-meter-value", children: [spent, "%"] })] }), _jsx("div", { className: "minimax-track", role: "meter", "aria-valuenow": spent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label, children: _jsx("i", { className: win.unlimited ? 'minimax-fill unlimited' : 'minimax-fill', style: { width: `${win.unlimited ? 100 : spent}%` } }) }), _jsxs("div", { className: "minimax-meter-foot", children: [win.unlimited
                        ? _jsx("span", { children: t('usage.unlimited') })
                        : _jsxs("span", { children: [t('usage.used'), " ", spent, "% \u00B7 ", t('usage.left'), " ", Math.max(0, 100 - spent), "%"] }), win.resetAtMs !== null && _jsxs("span", { children: [t('usage.resets'), " ", stamp(win.resetAtMs)] })] })] }));
}
/**
 * Render the whole MiniMax page.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the page element.
 */
export function MinimaxPage(props) {
    const { state, quota, loading, busy, error, signIn, signOut } = useMinimaxSurface(props);
    const { t } = props;
    const [selected, setSelected] = useState('weekly');
    if (loading) {
        return (_jsx("div", { className: "minimax-page", "aria-busy": "true", children: _jsx(StateDot, { state: "ongoing" }) }));
    }
    const status = state?.status ?? 'signed-out';
    const authorizing = status === 'authorizing';
    const authenticated = status === 'authenticated';
    // Not named `window`: that would shadow the global the open call needs.
    const activeWindow = quota?.windows.find(w => w.id === selected);
    const options = [
        { value: 'interval', label: t('usage.interval') },
        { value: 'weekly', label: t('usage.weekly') },
    ];
    return (_jsxs("div", { className: "minimax-page", "data-plugin": "minimax-coding-plan", children: [_jsxs("header", { className: "minimax-head", children: [_jsxs("div", { children: [_jsx("h2", { children: t('card.title') }), _jsx("p", { className: "minimax-sub", children: t('card.subtitle') })] }), _jsxs(Pill, { active: authenticated, children: [_jsx(StateDot, { state: dotFor(status), size: 8 }), _jsx("span", { className: "minimax-pill-text", children: authenticated ? t('status.authenticated') : authorizing ? t('status.authorizing') : t('status.signedOut') })] })] }), authorizing && (_jsxs("div", { className: "minimax-device", children: [_jsxs("div", { className: "minimax-device-row", children: [_jsx("span", { className: "minimax-device-label", children: t('code') }), _jsx("code", { className: "minimax-code", children: state?.userCode }), state?.verificationUri && (_jsx(Button, { variant: "primary", size: "sm", onClick: () => { window.open(state.verificationUri, '_blank', 'noreferrer'); }, children: t('openVerification') }))] }), _jsxs("p", { className: "minimax-sub", children: [t('codeExpires'), " ", state?.expiresInSec, " ", t('seconds')] })] })), authenticated && (_jsxs("dl", { className: "minimax-facts", children: [_jsxs("div", { children: [_jsx("dt", { children: t('accountId') }), _jsx("dd", { children: state?.accountId ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { children: t('region') }), _jsx("dd", { children: state?.region })] }), _jsxs("div", { children: [_jsx("dt", { children: t('expiresAt') }), _jsx("dd", { children: stamp(state?.expiresAtMs) })] })] })), error !== undefined && (_jsxs("p", { className: "minimax-error", role: "alert", children: [_jsx(StateDot, { state: "error", size: 8 }), " ", t('error'), ": ", error] })), _jsxs("div", { className: "minimax-actions", children: [_jsx(Button, { variant: "primary", onClick: signIn, disabled: busy || status !== 'signed-out', children: authorizing ? t('signInBusy') : t('signIn') }), _jsx(Button, { variant: "outline", onClick: signOut, disabled: busy || !authenticated, children: t('signOut') })] }), _jsxs("section", { className: "minimax-usage", children: [_jsxs("div", { className: "minimax-usage-head", children: [_jsx("h3", { children: t('usage.section') }), authenticated && (_jsx(SegmentedControl, { id: "minimax-window", value: selected, options: options, onChange: setSelected, label: t('usage.section'), disabled: busy }))] }), !authenticated
                        ? _jsx("p", { className: "minimax-empty", children: quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint') })
                        : quota?.error != null
                            ? _jsxs("p", { className: "minimax-error", children: [_jsx(StateDot, { state: "error", size: 8 }), " ", quota.error] })
                            : activeWindow === undefined
                                ? _jsx("p", { className: "minimax-empty", children: t('usage.missing') })
                                : _jsx(UsageBar, { window: activeWindow, label: options.find(o => o.value === selected)?.label ?? selected, t: t }), quota?.planLabel != null && _jsxs("p", { className: "minimax-sub", children: ["\u5957\u9910 ", quota.planLabel] })] })] }));
}
//# sourceMappingURL=MinimaxPage.js.map