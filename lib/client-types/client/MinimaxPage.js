import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Button, Pill, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import clsx from 'clsx';
import { useState } from 'react';
import styles from './MinimaxPage.module.css';
import { useMinimaxSurface } from "./useMinimaxSurface.js";
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
        return _jsx("p", { className: styles.empty, children: t('usage.unmetered') });
    // Share of the window's own total, not of a nominal 100: a plan metered at a
    // different allowance would otherwise render as always half spent.
    const total = win.totalPercent > 0 ? win.totalPercent : 100;
    const spent = win.unlimited ? 0 : Math.min(100, Math.round(win.usedPercent / total * 100));
    return (_jsxs("div", { className: styles.meter, children: [_jsxs("div", { className: styles.meterHead, children: [_jsx("span", { className: styles.meterLabel, children: win.unlimited ? t('usage.unlimited') : label }), !win.unlimited && _jsxs("span", { className: styles.meterValue, children: [spent, "%"] })] }), _jsx("div", { className: styles.track, role: "meter", "aria-valuenow": spent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label, children: _jsx("i", { className: clsx(styles.fill, win.unlimited && styles.fillUnlimited), style: { width: `${win.unlimited ? 100 : spent}%` } }) }), _jsxs("div", { className: styles.meterFoot, children: [win.unlimited
                        ? _jsx("span", { children: t('usage.unlimited') })
                        : _jsxs("span", { children: [t('usage.used'), " ", spent, "% \u00B7 ", t('usage.left'), " ", Math.max(0, 100 - spent), "%"] }), win.resetAtMs !== null && _jsxs("span", { children: [t('usage.resets'), " ", stamp(win.resetAtMs)] })] })] }));
}
/**
 * Render the whole MiniMax page.
 * @param props - slot composition for this entry.
 * @returns the page element.
 */
export function MinimaxPage(props) {
    const { state, quota, loading, busy, error, signIn, signOut } = useMinimaxSurface(props);
    const { t } = props;
    const [selected, setSelected] = useState('weekly');
    if (loading) {
        return (_jsx("div", { className: styles.page, "aria-busy": "true", children: _jsx(StateDot, { state: "ongoing" }) }));
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
    return (_jsxs("div", { className: styles.page, "data-plugin": "minimax-coding-plan", children: [_jsxs("header", { className: styles.head, children: [_jsxs("div", { children: [_jsx("h2", { className: styles.title, children: t('card.title') }), _jsx("p", { className: styles.sub, children: t('card.subtitle') })] }), _jsxs(Pill, { active: authenticated, children: [_jsx(StateDot, { state: dotFor(status), size: 8 }), _jsx("span", { className: styles.pillText, children: authenticated ? t('status.authenticated') : authorizing ? t('status.authorizing') : t('status.signedOut') })] })] }), authorizing && (_jsxs("div", { className: styles.device, children: [_jsxs("div", { className: styles.deviceRow, children: [_jsx("span", { className: styles.deviceLabel, children: t('code') }), _jsx("code", { className: styles.code, children: state?.userCode }), state?.verificationUri && (_jsx(Button, { variant: "primary", size: "sm", onClick: () => { window.open(state.verificationUri, '_blank', 'noreferrer'); }, children: t('openVerification') }))] }), _jsxs("p", { className: styles.sub, children: [t('codeExpires'), " ", state?.expiresInSec, " ", t('seconds')] })] })), authenticated && (_jsxs("dl", { className: styles.facts, children: [_jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('accountId') }), _jsx("dd", { className: styles.factValue, children: state?.accountId ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('region') }), _jsx("dd", { className: styles.factValue, children: state?.region })] }), _jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('expiresAt') }), _jsx("dd", { className: styles.factValue, children: stamp(state?.expiresAtMs) })] })] })), error !== undefined && (_jsxs("p", { className: styles.error, role: "alert", children: [_jsx(StateDot, { state: "error", size: 8 }), " ", t('error'), ": ", error] })), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "primary", onClick: signIn, disabled: busy || status !== 'signed-out', children: authorizing ? t('signInBusy') : t('signIn') }), _jsx(Button, { variant: "outline", onClick: signOut, disabled: busy || !authenticated, children: t('signOut') })] }), _jsxs("section", { className: styles.usage, children: [_jsxs("div", { className: styles.usageHead, children: [_jsx("h3", { className: styles.usageTitle, children: t('usage.section') }), authenticated && (_jsx(SegmentedControl, { id: "minimax-window", value: selected, options: options, onChange: setSelected, label: t('usage.section'), disabled: busy }))] }), !authenticated
                        ? _jsx("p", { className: styles.empty, children: quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint') })
                        : quota?.error != null
                            ? _jsxs("p", { className: styles.error, children: [_jsx(StateDot, { state: "error", size: 8 }), " ", quota.error] })
                            : activeWindow === undefined
                                ? _jsx("p", { className: styles.empty, children: t('usage.missing') })
                                : _jsx(UsageBar, { window: activeWindow, label: options.find(o => o.value === selected)?.label ?? selected, t: t }), quota?.planLabel != null && _jsxs("p", { className: styles.sub, children: [t('usage.plan'), " ", quota.planLabel] })] })] }));
}
//# sourceMappingURL=MinimaxPage.js.map