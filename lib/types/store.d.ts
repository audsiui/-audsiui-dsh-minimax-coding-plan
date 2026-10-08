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
/**
 * Validate any JSON value into a stored credential.
 *
 * This is the single answer to "what is a valid `StoredCredential`", and both
 * places a record can arrive — the credential seam's opaque payload and the
 * legacy file — go through it. They used to carry their own checks, and the two
 * copies had already drifted: the seam's reader refused a record with an empty
 * `region` while the file's reader accepted it and substituted `''`. The field
 * is required and non-empty here, which is what a grant actually needs: a
 * record that names no region cannot be matched against this installation's
 * configured one, so it is not a credential, it is debris.
 *
 * Every rejection reads as signed out rather than as a half-working grant. The
 * scope check matters most: a token without `agent.default` cannot call anything.
 *
 * @param raw - a parsed JSON value of unknown shape.
 * @returns the validated record, or undefined when it is not one.
 */
export declare function parseStoredCredential(raw: unknown): StoredCredential | undefined;
/**
 * Build the record a grant is stored as, with every absent key omitted.
 *
 * The omission is the load-bearing part. The credential store validates a
 * payload as *representable in JSON* before it writes one, and a property
 * explicitly set to `undefined` fails that check even though `JSON.stringify`
 * would have dropped it silently — `Object.values` walks present keys regardless
 * of what they hold (`@deepseek-ai/dsh-credentials-local/lib/index.js:302-307`).
 * Writing `accountId: undefined` therefore wedged the whole store: the record
 * landed, and the next Host start refused to load with `record "…/default"
 * payload holds a value JSON cannot represent` — a crash the plugin could not
 * recover from, because it happens before any of this code runs.
 *
 * Omission is the encoding "absent" already uses everywhere else here, and
 * {@link parseStoredCredential} reads a missing key as absent, so nothing
 * downstream has to know the difference.
 *
 * @param grant - the token set to persist.
 * @param region - region whose account origin issued it.
 * @returns the record, ready to be written through either store.
 */
export declare function toStoredCredential(grant: TokenGrant, region: string): StoredCredential;
/**
 * Load a stored credential, treating any unreadable file as signed out.
 *
 * @param path - absolute path of the legacy JSON record.
 * @returns the validated record, or undefined.
 */
export declare function readCredential(path: string): Promise<StoredCredential | undefined>;
/**
 * Persist a grant, replacing any previous record atomically.
 *
 * @param path - absolute path of the legacy JSON record.
 * @param grant - the token set to persist.
 * @param region - region whose account origin issued it.
 */
export declare function writeCredential(path: string, grant: TokenGrant, region: string): Promise<void>;
/** Remove any stored credential, tolerating an already-absent file. */
export declare function clearCredential(path: string): Promise<void>;
//# sourceMappingURL=store.d.ts.map