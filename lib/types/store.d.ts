import type { TokenGrant } from './oauth.ts';
/**
 * On-disk credential record.
 *
 * `refreshToken`, `accountId` and `subject` are **absent**, not `undefined`.
 * The credential store validates a record's payload in both directions and
 * rejects a property explicitly set to `undefined` — `Object.values` walks
 * present keys whether or not their value is representable, so "key exists,
 * value undefined" and "key missing" are different things to it
 * (`@deepseek-ai/dsh-credentials-local/lib/index.js:302-307`, and
 * `dsh-credentials-local/README.zh.md:111`: the payload must survive a JSON
 * round trip). Declaring the fields optional matches how the seam states its own
 * defaults (`dsh-credentials/lib/types/types.d.ts:37,39`), so the type no longer
 * advertises a value the store would reject.
 */
export interface StoredCredential {
    readonly schemaVersion: 1;
    readonly clientId: string;
    readonly accessToken: string;
    /**
     * Absent when the server issued no refresh token (RFC 8628 §3.5 makes it
     * optional). The access token stays usable to its expiry; only refreshing is
     * unavailable, so its absence is not a reason to read the record as signed out.
     */
    readonly refreshToken?: string;
    /** Absolute access-token expiry. */
    readonly expiresAtMs: number;
    readonly scopes: readonly string[];
    /** Stable account id, when the access token carried one. */
    readonly accountId?: string;
    /** Stable user id, when the access token carried one. */
    readonly subject?: string;
    /** Region whose account origin issued this grant. */
    readonly region: string;
}
/** Load a stored credential, treating any unreadable file as signed out. */
export declare function readCredential(path: string): Promise<StoredCredential | undefined>;
/** Persist a grant, replacing any previous record atomically. */
export declare function writeCredential(path: string, grant: TokenGrant, region: string): Promise<void>;
/** Remove any stored credential, tolerating an already-absent file. */
export declare function clearCredential(path: string): Promise<void>;
//# sourceMappingURL=store.d.ts.map