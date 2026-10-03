import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useMinimaxSurface } from "./useMinimaxSurface.js";
/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms) {
    if (ms === null || ms === undefined)
        return '';
    return new Date(ms).toLocaleString();
}
/**
 * Render the usage readout for one window.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the usage element.
 */
export function MinimaxUsageBars(props) {
    const { state, quota, loading } = useMinimaxSurface(props);
    const { t } = props;
    const [selected, setSelected] = useState('weekly');
    if (loading)
        return _jsx("div", { "data-plugin": "minimax-coding-plan", "aria-busy": "true" });
    if (state?.status !== 'authenticated') {
        return (_jsx("div", { "data-plugin": "minimax-coding-plan", children: _jsx("p", { children: quota?.authExpired ? t('usage.authExpired') : t('usage.signedOutHint') }) }));
    }
    const window = quota?.windows.find(w => w.id === selected);
    const tabs = ['interval', 'weekly'];
    const label = selected === 'weekly' ? t('usage.weekly') : t('usage.interval');
    // Share of the window's own total, not of a nominal 100: a plan metered at a
    // different allowance would otherwise render as always half spent.
    const spent = window !== undefined && window.totalPercent > 0
        ? Math.min(100, Math.round(window.usedPercent / window.totalPercent * 100))
        : 0;
    const left = window === undefined || window.totalPercent <= 0
        ? 0
        : Math.max(0, Math.round((window.totalPercent - window.usedPercent) / window.totalPercent * 100));
    return (_jsxs("div", { "data-plugin": "minimax-coding-plan", children: [_jsx("div", { role: "tablist", children: tabs.map(id => (_jsx("button", { type: "button", role: "tab", "aria-selected": id === selected, onClick: () => { setSelected(id); }, children: id === 'weekly' ? t('usage.weekly') : t('usage.interval') }, id))) }), quota?.error != null && _jsx("p", { "data-role": "quota-error", role: "alert", children: quota.error }), window === undefined
                ? _jsx("p", { children: t('usage.missing') })
                : !window.present
                    ? _jsx("p", { children: t('usage.unmetered') })
                    : (_jsxs(_Fragment, { children: [_jsxs("div", { "data-role": "usage", "data-window": selected, children: [_jsx("span", { children: window.unlimited ? t('usage.unlimited') : label }), _jsx("div", { role: "meter", "aria-valuenow": spent, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label, children: _jsx("i", { style: { width: `${window.unlimited ? 100 : spent}%` } }) }), !window.unlimited && (_jsxs("small", { children: [t('usage.used'), " ", spent, "% \u00B7 ", t('usage.left'), " ", left, "%"] })), window.resetAtMs !== null && (_jsxs("small", { children: [t('usage.resets'), " ", stamp(window.resetAtMs)] }))] }), quota?.planLabel != null && _jsx("small", { "data-role": "plan", children: quota.planLabel })] }))] }));
}
//# sourceMappingURL=MinimaxUsageBars.js.map