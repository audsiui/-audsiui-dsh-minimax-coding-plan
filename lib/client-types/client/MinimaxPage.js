import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
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
import { Button, Pill, SegmentedControl, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { useState } from 'react';
import styles from './MinimaxPage.module.css';
import { useMinimaxSurface } from "./useMinimaxSurface.js";
/**
 * A plan within this many days of lapsing is worth flagging rather than
 * showing as an ordinary date. Chosen to be well outside a monthly billing
 * cycle so a normally-paid plan never trips it.
 */
const PLAN_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;
/** Format an epoch instant as a local date and time, or nothing. */
function stamp(ms) {
    if (ms === null || ms === undefined)
        return '';
    return new Date(ms).toLocaleString();
}
/** Format an epoch instant as a plain local date, for a plan that lasts months. */
function date(ms) {
    if (ms === null || ms === undefined)
        return '';
    return new Date(ms).toLocaleDateString();
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
/**
 * The localized name for a `model_name` the service groups its windows under.
 *
 * The Host sends the raw name because a Chinese string has no locale to travel
 * with across the Remote boundary; the wording belongs here. An unrecognised
 * name is passed through untouched rather than collapsed into a bucket it may
 * not belong to.
 */
function modelLabel(model, t) {
    if (model === 'general')
        return t('model.general');
    if (model === 'video')
        return t('model.video');
    return model;
}
/**
 * Clamp a ratio into the 0-100 a bar can actually draw.
 * @returns the share of the window's own total that is consumed.
 */
function ratio(used, total) {
    if (!Number.isFinite(total) || total <= 0)
        return 0;
    return Math.max(0, Math.min(100, Math.round(used / total * 100)));
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
function levelOf(spent) {
    if (spent >= 100)
        return 'spent';
    if (spent >= 80)
        return 'high';
    return undefined;
}
/**
 * The currency one window is metered in.
 *
 * A window reports a real request count, a percentage pair, or both. `video`
 * reports both on the same entry; `general` reports only percentages, because
 * the service sends `-1` for every count there rather than omitting them. So the
 * count wins where there is one — it is the figure that actually decrements —
 * and the percentage is the fallback, not the alternative.
 */
function meterKind(win) {
    return win.totalCount !== null && win.totalCount > 0 ? 'count' : 'percent';
}
/** Render one model's allowance window as a labelled bar. */
function UsageBar(props) {
    const { win, label, t } = props;
    const name = modelLabel(win.model, t);
    if (!win.present) {
        return (_jsxs("li", { className: styles.meter, children: [_jsx("div", { className: styles.meterHead, children: _jsxs("span", { className: styles.meterLabel, children: [name, " \u00B7 ", label] }) }), _jsx("p", { className: styles.empty, children: t('usage.unmetered') })] }));
    }
    const byCount = meterKind(win) === 'count';
    // An unmetered window has nothing to draw a bar against, so it is stated and
    // not graphed. The percentages are still reported below it, because the
    // service keeps sending them and they are still true.
    const spent = win.unlimited
        ? 0
        : byCount
            ? ratio(win.usedCount ?? 0, win.totalCount ?? 1)
            : ratio(win.usedPercent, win.totalPercent);
    const value = win.unlimited
        ? t('usage.unlimited')
        : byCount
            ? t('usage.counts', { used: String(win.usedCount ?? 0), total: String(win.totalCount ?? 0) })
            : t('usage.percents', { used: String(win.usedPercent), total: String(win.totalPercent) });
    return (_jsxs("li", { className: styles.meter, "data-level": win.unlimited ? undefined : levelOf(spent), children: [_jsxs("div", { className: styles.meterHead, children: [_jsxs("span", { className: styles.meterLabel, children: [name, " \u00B7 ", label] }), _jsx("span", { className: styles.meterValue, children: value })] }), !win.unlimited && (_jsx("div", { className: styles.track, role: "meter", "aria-valuenow": spent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": `${name} ${label}`, children: _jsx("i", { className: styles.fill, style: { width: `${spent}%` } }) })), _jsxs("div", { className: styles.meterFoot, children: [_jsx("span", { children: win.unlimited ? t('usage.unlimited') : byCount ? t('usage.byCount') : t('usage.byPercent') }), win.remainsMs !== null && _jsxs("span", { children: [t('usage.remains'), " ", formatDuration(win.remainsMs)] }), win.resetAtMs !== null && _jsxs("span", { children: [t('usage.resets'), " ", stamp(win.resetAtMs)] })] })] }));
}
/**
 * Render the whole MiniMax page.
 * @param props - slot composition for this entry.
 * @returns the page element.
 */
export function MinimaxPage(props) {
    const { state, plan, quota, loading, busy, error, signIn, signOut } = useMinimaxSurface(props);
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
    // A plan inside the warning horizon is worth a different tone; one already
    // lapsed is worth a worse one. Both are read off the instant the service sent.
    const planTone = (() => {
        if (plan?.planExpiresAtMs == null)
            return 'neutral';
        const left = plan.planExpiresAtMs - Date.now();
        if (left <= 0)
            return 'danger';
        if (left <= PLAN_EXPIRY_WARNING_MS)
            return 'warning';
        return 'info';
    })();
    return (_jsxs("div", { className: styles.page, "data-plugin": "minimax-coding-plan", children: [_jsxs("header", { className: styles.head, children: [_jsxs("div", { children: [_jsx("h2", { className: styles.title, children: t('card.title') }), _jsx("p", { className: styles.sub, children: t('card.subtitle') })] }), _jsxs(Pill, { active: authenticated, children: [_jsx(StateDot, { state: dotFor(status), size: 8 }), _jsx("span", { className: styles.pillText, children: authenticated ? t('status.authenticated') : authorizing ? t('status.authorizing') : t('status.signedOut') })] })] }), authorizing && (_jsxs("div", { className: styles.device, children: [_jsxs("div", { className: styles.deviceRow, children: [_jsx("span", { className: styles.deviceLabel, children: t('code') }), _jsx("code", { className: styles.code, children: state?.userCode }), state?.verificationUri && (_jsx(Button, { variant: "primary", size: "sm", onClick: () => { window.open(state.verificationUri, '_blank', 'noreferrer'); }, children: t('openVerification') }))] }), _jsxs("p", { className: styles.sub, children: [t('codeExpires'), " ", state?.expiresInSec, " ", t('seconds')] })] })), authenticated && (_jsxs("section", { className: styles.identity, "aria-label": t('identity.title'), children: [_jsxs("div", { className: styles.identityHead, children: [_jsxs("div", { className: styles.identityNames, children: [_jsx("h3", { className: styles.accountName, children: plan?.accountName ?? t('account.unknown') }), plan?.accountId != null && _jsx("p", { className: styles.accountId, children: plan.accountId })] }), plan?.tier != null
                                ? _jsx(Tag, { tone: planTone, children: plan.tier })
                                : _jsx(Tag, { tone: "quiet", children: t('plan.none') })] }), _jsxs("dl", { className: styles.facts, children: [_jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('plan.expiresAt') }), _jsx("dd", { className: styles.factValue, children: date(plan?.planExpiresAtMs) || t('plan.expiresUnknown') })] }), _jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('expiresAt') }), _jsx("dd", { className: styles.factValue, children: stamp(state?.expiresAtMs) || t('plan.expiresUnknown') })] }), _jsxs("div", { children: [_jsx("dt", { className: styles.factLabel, children: t('region') }), _jsx("dd", { className: styles.factValue, children: state?.region })] })] }), plan?.error != null && (_jsxs("p", { className: styles.note, children: [_jsx(StateDot, { state: "warning", size: 8 }), " ", t('plan.readFailed'), ": ", plan.error] }))] })), error !== undefined && (_jsxs("p", { className: styles.error, role: "alert", children: [_jsx(StateDot, { state: "error", size: 8 }), " ", t('error'), ": ", error] })), _jsxs("div", { className: styles.actions, children: [_jsx(Button, { variant: "primary", onClick: signIn, disabled: busy || status !== 'signed-out', children: authorizing ? t('signInBusy') : t('signIn') }), _jsx(Button, { variant: "outline", onClick: signOut, disabled: busy || !authenticated, children: t('signOut') })] }), _jsxs("section", { className: styles.usage, children: [_jsxs("div", { className: styles.usageHead, children: [_jsx("h3", { className: styles.usageTitle, children: t('usage.section') }), authenticated && (_jsx(SegmentedControl, { id: "minimax-window", value: selected, options: options, onChange: setSelected, label: t('usage.section'), disabled: busy }))] }), !authenticated
                        ? _jsx("p", { className: styles.empty, children: quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint') })
                        : quota?.error != null
                            ? _jsxs("p", { className: styles.error, children: [_jsx(StateDot, { state: "error", size: 8 }), " ", quota.error] })
                            : selectedWindows.length === 0
                                ? _jsx("p", { className: styles.empty, children: t('usage.missing') })
                                : _jsx("ul", { className: styles.meters, children: selectedWindows.map(win => (_jsx(UsageBar, { win: win, label: selectedLabel, t: t }, `${win.model}/${win.window}`))) }), authenticated && quota?.error == null && quota != null && (_jsx("p", { className: styles.stamp, children: t('usage.updatedAt', { time: stamp(quota.fetchedAtMs) }) }))] })] }));
}
//# sourceMappingURL=MinimaxPage.js.map