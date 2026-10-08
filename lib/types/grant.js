import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { clearCredential, parseStoredCredential, readCredential, toStoredCredential, writeCredential, } from "./store.js";
/** Scope segment of the credential key; the harness requires the plugin's own cordis name. */
const SCOPE = 'llm-minimax-coding-plan';
/** Addressing unit within the scope; one MiniMax account per plugin. */
const ID = 'default';
/** The record this plugin owns. */
export const GRANT_KEY = credentialKey(SCOPE, ID);
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
            const parsed = parseStoredCredential(record.payload);
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
    await store.modifyRecord(GRANT_KEY, () => Promise.resolve({ kind: 'grant', payload: toStoredCredential(grant, region) }));
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