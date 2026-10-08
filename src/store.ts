/** File-backed persistence for the MiniMax credential grant. */
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { OAUTH_CLIENT_ID, OAUTH_SCOPE } from './constants.ts'
import type { TokenGrant } from './oauth.ts'

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
  readonly schemaVersion: 1
  readonly clientId: string
  readonly accessToken: string
  /**
   * Absent when the server issued no refresh token (RFC 8628 §3.5 makes it
   * optional). The access token stays usable to its expiry; only refreshing is
   * unavailable, so its absence is not a reason to read the record as signed out.
   */
  readonly refreshToken?: string
  /** Absolute access-token expiry. */
  readonly expiresAtMs: number
  readonly scopes: readonly string[]
  /** Stable account id, when the access token carried one. */
  readonly accountId?: string
  /** Stable user id, when the access token carried one. */
  readonly subject?: string
  /** Region whose account origin issued this grant. */
  readonly region: string
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
export function parseStoredCredential(raw: unknown): StoredCredential | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Partial<StoredCredential>
  if (record.schemaVersion !== 1) return undefined
  if (record.clientId !== OAUTH_CLIENT_ID) return undefined
  if (typeof record.accessToken !== 'string' || !record.accessToken) return undefined
  if (typeof record.expiresAtMs !== 'number' || !Number.isFinite(record.expiresAtMs)) return undefined
  if (!Array.isArray(record.scopes) || !record.scopes.every(scope => typeof scope === 'string')) return undefined
  if (!record.scopes.includes(OAUTH_SCOPE)) return undefined
  if (typeof record.region !== 'string' || !record.region) return undefined
  return {
    schemaVersion: 1,
    clientId: OAUTH_CLIENT_ID,
    accessToken: record.accessToken,
    expiresAtMs: record.expiresAtMs,
    scopes: record.scopes,
    region: record.region,
    // Conditional spreads, not `key: value ?? undefined`. With
    // `exactOptionalPropertyTypes` the latter is a type error *and* would put the
    // key back on the object, which is the exact shape the credential store
    // rejects. A key that is not there is how absence is spelled here.
    ...(typeof record.refreshToken === 'string' && record.refreshToken ? { refreshToken: record.refreshToken } : {}),
    ...(typeof record.accountId === 'string' ? { accountId: record.accountId } : {}),
    ...(typeof record.subject === 'string' ? { subject: record.subject } : {}),
  }
}

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
export function toStoredCredential(grant: TokenGrant, region: string): StoredCredential {
  return {
    schemaVersion: 1,
    clientId: OAUTH_CLIENT_ID,
    accessToken: grant.accessToken,
    expiresAtMs: grant.expiresAtMs,
    scopes: grant.scopes,
    region,
    ...(grant.refreshToken === undefined ? {} : { refreshToken: grant.refreshToken }),
    ...(grant.accountId === undefined ? {} : { accountId: grant.accountId }),
    ...(grant.subject === undefined ? {} : { subject: grant.subject }),
  }
}

/**
 * Load a stored credential, treating any unreadable file as signed out.
 *
 * @param path - absolute path of the legacy JSON record.
 * @returns the validated record, or undefined.
 */
export async function readCredential(path: string): Promise<StoredCredential | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  }
  catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    // A truncated file must not wedge sign-in; treat it as absent.
    return undefined
  }
  return parseStoredCredential(parsed)
}

/**
 * Persist a grant, replacing any previous record atomically.
 *
 * @param path - absolute path of the legacy JSON record.
 * @param grant - the token set to persist.
 * @param region - region whose account origin issued it.
 */
export async function writeCredential(path: string, grant: TokenGrant, region: string): Promise<void> {
  const record = toStoredCredential(grant, region)
  // 0700, not the default: this file is the only copy of a bearer and a refresh
  // token, and a directory another local user can list is a directory they can
  // race. `docs/defensive-patterns.zh.md:31`.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  // Same-directory temp file then rename: a crash mid-write leaves the previous
  // record intact instead of a half-written one.
  //
  // The temp name is random and the open is exclusive. `${path}.${pid}.tmp` was
  // both guessable and opened with the default `'w'` flag, which follows a
  // pre-planted symlink — a local attacker who can predict the name can read the
  // token, or redirect the write. `docs/defensive-patterns.zh.md:31` requires a
  // random name in a 0700 directory opened exclusively and owner-only; `'wx'`
  // plus `0o600` is that.
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(16).toString('hex')}.tmp`)
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  try {
    await chmod(temporary, 0o600)
  }
  catch {
    // Filesystems without POSIX modes (Windows) reject chmod; the parent
    // directory already scopes the file to the current user.
  }
  await rename(temporary, path)
}

/** Remove any stored credential, tolerating an already-absent file. */
export async function clearCredential(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  }
  catch (error) {
    if (!isMissing(error)) throw error
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === 'ENOENT'
}
