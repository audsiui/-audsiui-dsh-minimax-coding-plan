/**
 * Access to the MiniMax grant through the harness credential seam.
 *
 * `ctx.credentials` is where a credential belongs: the authorization flow
 * commits through it, the settings surface enumerates it, and a record left
 * behind by an uninstalled plugin is recognisable as an orphan rather than a
 * working credential. The private JSON file remains the fallback so a grant
 * written by `signin.mjs` keeps working across this change.
 *
 * The seam never interprets the payload — `GrantRecord.payload` is opaque JSON
 * whose only requirement is that it survives a round trip — so the shape below
 * is this plugin's own and is validated on the way out exactly as the file
 * store validates its own.
 */
import type { Context } from '@deepseek-ai/cordis';
import { type CredentialKey } from '@deepseek-ai/dsh-credentials';
import type { TokenGrant } from './oauth.ts';
import { type StoredCredential } from './store.ts';
/** The record this plugin owns. */
export declare const GRANT_KEY: CredentialKey;
/**
 * Validate an opaque payload back into a usable grant.
 *
 * Mirrors the file store's checks, so a record this plugin cannot interpret
 * reads as signed out rather than as a half-working credential. The scope
 * check matters most: a token without `agent.default` cannot call anything.
 */
export declare function parseGrantPayload(payload: unknown): StoredCredential | undefined;
/**
 * Build the payload a grant is stored as, with every absent key omitted.
 *
 * The credential store validates a payload as *representable in JSON* before it
 * writes one, and a property explicitly set to `undefined` fails that check even
 * though `JSON.stringify` would have dropped it silently — `Object.values` walks
 * present keys regardless of what they hold
 * (`@deepseek-ai/dsh-credentials-local/lib/index.js:302-307`). Writing
 * `accountId: undefined` therefore wedged the whole store: the record landed,
 * and the next Host start refused to load with `record "…/default" payload
 * holds a value JSON cannot represent` — a crash the plugin could not recover
 * from, because it happens before any of this code runs.
 *
 * Omission is the encoding "absent" already uses everywhere else here, and
 * `parseGrantPayload` reads a missing key as absent, so nothing downstream has
 * to know the difference.
 */
export declare function grantPayload(grant: TokenGrant, region: string): StoredCredential;
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