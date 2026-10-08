/**
 * Access to the MiniMax grant through the harness credential seam.
 *
 * `ctx.credentials` is where a credential belongs: the authorization flow
 * commits through it, the settings surface enumerates it, and a record left
 * behind by an uninstalled plugin is recognisable as an orphan rather than a
 * working credential. The private JSON file remains the fallback so a grant
 * written by `signin.mjs` keeps working across this change.
 *
 * This module is only the *routing*: which of the two locations answers a read,
 * a write, or a clear. What a valid record is — and how one is built — belongs to
 * `store.ts`, which both locations share, so the seam and the file cannot drift
 * into accepting different shapes.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type CredentialKey } from '@deepseek-ai/dsh-credentials';
import { type StoredCredential } from './store.ts';
import type { TokenGrant } from './oauth.ts';
/** The record this plugin owns. */
export declare const GRANT_KEY: CredentialKey;
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
export declare function readGrant(ctx: Context, filePath: string): Promise<StoredCredential | undefined>;
/**
 * Persist a grant through the seam, falling back to the file when none is mounted.
 *
 * @param ctx - context whose credential store is written when one is mounted.
 * @param filePath - legacy location written only without a store.
 * @param grant - the token set to persist.
 * @param region - region whose account origin issued it.
 */
export declare function writeGrant(ctx: Context, filePath: string, grant: TokenGrant, region: string): Promise<void>;
/**
 * Remove the grant from both locations, so a stale file cannot outlive a sign-out.
 *
 * @param ctx - context whose credential store is cleared when one is mounted.
 * @param filePath - legacy location cleared unconditionally.
 */
export declare function clearGrant(ctx: Context, filePath: string): Promise<void>;
//# sourceMappingURL=grant.d.ts.map