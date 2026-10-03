import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
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
import { useState } from 'react';
import styles from './MinimaxPage.module.css';
import { useMinimaxSurface } from "./useMinimaxSurface.js";
/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms) {
    if (ms === null || ms === undefined)
        return '';
    return new Date(ms).toLocaleString();
}
/**
 * Format a remaining duration the way the service counts it: milliseconds.
 * The service reports these as plain numbers (`remains_time`, `weekly_remains_time`),
 * not as an instant, so there is nothing to convert against a clock.
 * @param ms - duration in milliseconds.
 * @returns a short human duration.
 */
function formatDuration(ms) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 48)
        return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
/** Map the account status onto the dot's semantics. */
function dotFor(status) {
    if (status === 'authenticated')
        return 'done';
    if (status === 'authorizing')
        return 'ongoing';
    return 'idle';
}
/** Render one model's allowance window as a labelled bar. */
function UsageBar(props) {
    const { win, label, t } = props;
    if (!win.present) {
        return (_jsxs("div", { className: styles.meter, children: [_jsx("div", { className: styles.meterHead, children: _jsxs("span", { className: styles.meterLabel, children: [win.model, " \u00B7 ", label] }) }), _jsx("p", { className: styles.empty, children: t('usage.unmetered') })] }));
    }
    // Share of the window's own total, not of a nominal 100: this plan's weekly
    // window is metered at 150%, and a bar computed against 100 would show it
    // permanently two-thirds spent.
    const total = win.totalPercent > 0 ? win.totalPercent : 100;
    const spent = Math.min(100, Math.max(0, Math.round(win.usedPercent / total * 100)));
    return (_jsxs("div", { className: styles.meter, children: [_jsxs("div", { className: styles.meterHead, children: [_jsxs("span", { className: styles.meterLabel, children: [win.model, " \u00B7 ", label] }), _jsxs("span", { className: styles.meterValue, children: [spent, "%"] })] }), _jsx("div", { className: styles.track, role: "meter", "aria-valuenow": spent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `${win.model} ${label}`, children: _jsx("i", { className: styles.fill, style: { width: `${spent}%` } }) }), _jsxs("div", { className: styles.meterFoot, children: [_jsxs("span", { children: [t('usage.used'), " ", win.usedPercent, "% / ", win.totalPercent, "%"] }), win.remainsMs !== null && _jsxs("span", { children: [t('usage.remains'), " ", formatDuration(win.remainsMs)] }), win.resetAtMs !== null && _jsxs("span", { children: [t('usage.resets'), " ", stamp(win.resetAtMs)] })] })] }));
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
    // The service meters each model family separately, so the chosen window is a
    // filter rather than a single row: one bar per model that reports it.
    const options = [
        { value: 'interval', label: t('usage.interval') },
        { value: 'weekly', label: t('usage.weekly') },
    ];
    const selectedLabel = options.find(option => option.value === selected)?.label ?? selected;
    const selectedWindows = (quota?.windows ?? []).filter(win => win.window === selected);
    return (_jsxs("div", { className: styles.page, "data-plugin": "minimax-coding-plan", children: [_jsxs("header", { className: styles.head, children: [_jsxs("div", { children: [_jsx("h2", { className: styles.title, children: t('card.title') }), _jsx("p", { className: styles.sub, children: t('card.subtitle') })] }), _jsxs(Pill, { active: authenticated, children: [_jsx(StateDot, { state: dotFor(status), size: 8 }), _jsx("span", { className: styles.pillText, children: authenticated ? t('status.authenticated') : authorizing ? t('status.authorizing') : t('status.signedOut') })] })] }), authorizing && (_jsxs("div", { className: styles.device, children: [_jsxs("div", { className: styles.deviceRow, children: [_jsx("span", { className: styles.deviceLabel, children: t('code') }), _jsx("code", { className: styles.code, children: state?.userCode }), state?.verificationUri && (_jsx(Button, { variant: "primary", size: "sm", onClick: () => { window.open(state.verificationUri, '_blank', 'noreferrer'); }, children: t('openVerification') }))] }), _jsxs("p", { className: styles.sub, children: [t('codeExpires'), " ", state?.expiresInSec, " ", t('seconds')] })] })), authenticated && (_jsxs("dl", { className: styles.facts, children: [_jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('accountId') }), _jsx("dd", { className: styles.factValue, children: state?.accountId ?? '—' })] }), _jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('region') }), _jsx("dd", { className: styles.factValue, children: state?.region })] }), _jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('expiresAt') }), _jsx("dd", { className: styles.factValue, children: stamp(state?.expiresAtMs) })] })] })), error !== undefined && (_jsxs("p", { className: styles.error, role: "alert", children: [_jsx(StateDot, { state: "error", size: 8 }), " ", t('error'), ": ", error] })), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "primary", onClick: signIn, disabled: busy || status !== 'signed-out', children: authorizing ? t('signInBusy') : t('signIn') }), _jsx(Button, { variant: "outline", onClick: signOut, disabled: busy || !authenticated, children: t('signOut') })] }), _jsxs("section", { className: styles.usage, children: [_jsxs("div", { className: styles.usageHead, children: [_jsx("h3", { className: styles.usageTitle, children: t('usage.section') }), authenticated && (_jsx(SegmentedControl, { id: "minimax-window", value: selected, options: options, onChange: setSelected, label: t('usage.section'), disabled: busy }))] }), !authenticated
                        ? _jsx("p", { className: styles.empty, children: quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint') })
                        : quota?.error != null
                            ? _jsxs("p", { className: styles.error, children: [_jsx(StateDot, { state: "error", size: 8 }), " ", quota.error] })
                            : selectedWindows.length === 0
                                ? _jsx("p", { className: styles.empty, children: t('usage.missing') })
                                : selectedWindows.map(win => (_jsx(UsageBar, { win: win, label: selectedLabel, t: t }, `${win.model}/${win.window}`)))] })] }));
}
//# sourceMappingURL=MinimaxPage.js.map