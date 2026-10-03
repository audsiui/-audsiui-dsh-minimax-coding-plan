import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { OAUTH_CLIENT_ID, OAUTH_SCOPE } from "./constants.js";
import { clearCredential, readCredential, writeCredential } from "./store.js";
/** Scope segment of the credential key; the harness requires the plugin's own cordis name. */
const SCOPE = 'llm-minimax-coding-plan';
/** Addressing unit within the scope; one MiniMax account per plugin. */
const ID = 'default';
/** The record this plugin owns. */
export const GRANT_KEY = credentialKey(SCOPE, ID);
/**
 * Validate an opaque payload back into a usable grant.
 *
 * Mirrors the file store's checks, so a record this plugin cannot interpret
 * reads as signed out rather than as a half-working credential. The scope
 * check matters most: a token without `agent.default` cannot call anything.
 */
export function parseGrantPayload(payload) {
    if (typeof payload !== 'object' || payload === null)
        return undefined;
    const record = payload;
    if (record.schemaVersion !== 1)
        return undefined;
    if (record.clientId !== OAUTH_CLIENT_ID)
        return undefined;
    if (typeof record.accessToken !== 'string' || !record.accessToken)
        return undefined;
    if (typeof record.refreshToken !== 'string' || !record.refreshToken)
        return undefined;
    if (typeof record.expiresAtMs !== 'number' || !Number.isFinite(record.expiresAtMs))
        return undefined;
    if (!Array.isArray(record.scopes) || !record.scopes.every(scope => typeof scope === 'string'))
        return undefined;
    if (!record.scopes.includes(OAUTH_SCOPE))
        return undefined;
    if (typeof record.region !== 'string' || !record.region)
        return undefined;
    return {
        schemaVersion: 1,
        clientId: OAUTH_CLIENT_ID,
        accessToken: record.accessToken,
        refreshToken: record.refreshToken,
        expiresAtMs: record.expiresAtMs,
        scopes: record.scopes,
        accountId: typeof record.accountId === 'string' ? record.accountId : undefined,
        subject: typeof record.subject === 'string' ? record.subject : undefined,
        region: record.region,
    };
}
/** Build the payload a grant is stored as. */
export function grantPayload(grant, region) {
    return {
        schemaVersion: 1,
        clientId: OAUTH_CLIENT_ID,
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        expiresAtMs: grant.expiresAtMs,
        scopes: grant.scopes,
        accountId: grant.accountId,
        subject: grant.subject,
        region,
    };
}
/**
 * Read the stored grant, preferring the credential seam.
 *
 * The file is consulted only when the seam holds nothing usable, so a grant
 * written before this change — or by `signin.mjs` — is still honoured without
 * a migration step.
 *
 * @param ctx - context whose credential store is read when one is mounted.
 * @param filePath - fallback location of the legacy JSON record.
 * @returns the grant, or undefined when signed out.
 */
export async function readGrant(ctx, filePath) {
    const store = ctx.get('credentials');
    if (store !== undefined) {
        const record = await store.readRecord(GRANT_KEY);
        if (record?.kind === 'grant') {
            const parsed = parseGrantPayload(record.payload);
            if (parsed !== undefined)
                return parsed;
        }
    }
    return readCredential(filePath);
}
/**
 * Persist a grant through the seam, falling back to the file when none is mounted.
 *
 * @param ctx - context whose credential store is written when one is mounted.
 * @param filePath - legacy location written only without a store.
 * @param grant - the token set to persist.
 * @param region - region whose account origin issued it.
 */
export async function writeGrant(ctx, filePath, grant, region) {
    const store = ctx.get('credentials');
    if (store === undefined) {
        await writeCredential(filePath, grant, region);
        return;
    }
    await store.modifyRecord(GRANT_KEY, () => Promise.resolve({ kind: 'grant', payload: grantPayload(grant, region) }));
}
/**
 * Remove the grant from both locations, so a stale file cannot outlive a sign-out.
 *
 * @param ctx - context whose credential store is cleared when one is mounted.
 * @param filePath - legacy location cleared unconditionally.
 */
export async function clearGrant(ctx, filePath) {
    const store = ctx.get('credentials');
    if (store !== undefined)
        await store.deleteRecord(GRANT_KEY);
    await clearCredential(filePath);
}
//# sourceMappingURL=grant.js.map