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

/** Load a stored credential, treating any unreadable file as signed out. */
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
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Partial<StoredCredential>
  if (record.schemaVersion !== 1) return undefined
  if (record.clientId !== OAUTH_CLIENT_ID) return undefined
  if (typeof record.accessToken !== 'string' || !record.accessToken) return undefined
  if (typeof record.expiresAtMs !== 'number' || !Number.isFinite(record.expiresAtMs)) return undefined
  if (!Array.isArray(record.scopes) || !record.scopes.every(scope => typeof scope === 'string')) return undefined
  if (!record.scopes.includes(OAUTH_SCOPE)) return undefined
  return {
    schemaVersion: 1,
    clientId: OAUTH_CLIENT_ID,
    accessToken: record.accessToken,
    expiresAtMs: record.expiresAtMs,
    scopes: record.scopes,
    region: typeof record.region === 'string' ? record.region : '',
    // Spread so an absent key stays absent; naming it with a possibly-undefined
    // value would put the key back and hand the store a payload it rejects.
    ...(typeof record.refreshToken === 'string' && record.refreshToken ? { refreshToken: record.refreshToken } : {}),
    ...(typeof record.accountId === 'string' ? { accountId: record.accountId } : {}),
    ...(typeof record.subject === 'string' ? { subject: record.subject } : {}),
  }
}

/** Persist a grant, replacing any previous record atomically. */
export async function writeCredential(path: string, grant: TokenGrant, region: string): Promise<void> {
  // Keys whose value is `undefined` are dropped rather than written: a
  // property set to `undefined` is not a value JSON can represent, and the
  // credential store that reads this file back rejects such a record outright.
  // `readCredential` treats a missing key as absent, so nothing changes here.
  const record: Record<string, unknown> = {
    schemaVersion: 1,
    clientId: OAUTH_CLIENT_ID,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresAtMs: grant.expiresAtMs,
    scopes: grant.scopes,
    accountId: grant.accountId,
    subject: grant.subject,
    region,
  }
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key]
  }
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
