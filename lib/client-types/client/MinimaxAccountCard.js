import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMinimaxSurface } from "./useMinimaxSurface.js";
/** Format an epoch instant as a local timestamp, or nothing. */
function stamp(ms) {
    if (ms === null || ms === undefined)
        return '';
    return new Date(ms).toLocaleString();
}
/**
 * Render the MiniMax account controls.
 * @param props - slot owner props with this entry's injected Remote API.
 * @returns the card element.
 */
export function MinimaxAccountCard(props) {
    const { state, loading, busy, error, signIn, signOut } = useMinimaxSurface(props);
    const { t } = props;
    if (loading)
        return _jsx("div", { "data-plugin": "minimax-coding-plan", "aria-busy": "true" });
    const status = state?.status ?? 'signed-out';
    const statusKey = status === 'authenticated'
        ? 'status.authenticated'
        : status === 'authorizing' ? 'status.authorizing' : 'status.signedOut';
    return (_jsxs("div", { "data-plugin": "minimax-coding-plan", children: [_jsxs("div", { "data-role": "status", "data-status": status, children: [_jsx("strong", { children: t('card.title') }), _jsx("span", { children: t(statusKey) })] }), status === 'authorizing' && (_jsxs("div", { "data-role": "device-code", children: [_jsx("span", { children: t('code') }), _jsx("code", { children: state?.userCode }), state?.verificationUri && (_jsx("a", { href: state.verificationUri, target: "_blank", rel: "noreferrer", children: t('openVerification') })), _jsxs("small", { children: [t('codeExpires'), " ", state?.expiresInSec, " ", t('seconds')] })] })), status === 'authenticated' && (_jsxs("dl", { "data-role": "account", children: [_jsx("dt", { children: t('accountId') }), _jsx("dd", { children: state?.accountId ?? '—' }), _jsx("dt", { children: t('expiresAt') }), _jsx("dd", { children: stamp(state?.expiresAtMs) }), _jsx("dt", { children: t('region') }), _jsx("dd", { children: state?.region })] })), error !== undefined && _jsxs("p", { "data-role": "error", role: "alert", children: [t('error'), ": ", error] }), _jsxs("div", { "data-role": "actions", children: [_jsx("button", { type: "button", onClick: signIn, disabled: busy || status !== 'signed-out', children: status === 'authorizing' ? t('signInBusy') : t('signIn') }), _jsx("button", { type: "button", onClick: signOut, disabled: busy || status !== 'authenticated', children: t('signOut') })] })] }));
}
//# sourceMappingURL=MinimaxAccountCard.js.map