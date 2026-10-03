import type { TokenGrant } from './oauth.ts';
/** On-disk credential record. */
export interface StoredCredential {
    readonly schemaVersion: 1;
    readonly clientId: string;
    readonly accessToken: string;
    /**
     * Absent when the server issued no refresh token (RFC 8628 §3.5 makes it
     * optional). The access token stays usable to its expiry; only refreshing is
     * unavailable, so its absence is not a reason to read the record as signed out.
     */
    readonly refreshToken: string | undefined;
    /** Absolute access-token expiry. */
    readonly expiresAtMs: number;
    readonly scopes: readonly string[];
    readonly accountId: string | undefined;
    readonly subject: string | undefined;
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