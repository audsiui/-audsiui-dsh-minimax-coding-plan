/** File-backed persistence for the MiniMax credential grant. */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { OAUTH_CLIENT_ID, OAUTH_SCOPE } from "./constants.js";
/** Load a stored credential, treating any unreadable file as signed out. */
export async function readCredential(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (isMissing(error))
            return undefined;
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        // A truncated file must not wedge sign-in; treat it as absent.
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null)
        return undefined;
    const record = parsed;
    if (record.schemaVersion !== 1)
        return undefined;
    if (record.clientId !== OAUTH_CLIENT_ID)
        return undefined;
    if (typeof record.accessToken !== 'string' || !record.accessToken)
        return undefined;
    if (typeof record.expiresAtMs !== 'number' || !Number.isFinite(record.expiresAtMs))
        return undefined;
    if (!Array.isArray(record.scopes) || !record.scopes.every(scope => typeof scope === 'string'))
        return undefined;
    if (!record.scopes.includes(OAUTH_SCOPE))
        return undefined;
    return {
        schemaVersion: 1,
        clientId: OAUTH_CLIENT_ID,
        accessToken: record.accessToken,
        refreshToken: typeof record.refreshToken === 'string' && record.refreshToken ? record.refreshToken : undefined,
        expiresAtMs: record.expiresAtMs,
        scopes: record.scopes,
        accountId: typeof record.accountId === 'string' ? record.accountId : undefined,
        subject: typeof record.subject === 'string' ? record.subject : undefined,
        region: typeof record.region === 'string' ? record.region : '',
    };
}
/** Persist a grant, replacing any previous record atomically. */
export async function writeCredential(path, grant, region) {
    const record = {
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
    await mkdir(dirname(path), { recursive: true });
    // Same-directory temp file then rename: a crash mid-write leaves the previous
    // record intact instead of a half-written one.
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
        await chmod(temporary, 0o600);
    }
    catch {
        // Filesystems without POSIX modes (Windows) reject chmod; the parent
        // directory already scopes the file to the current user.
    }
    await rename(temporary, path);
}
/** Remove any stored credential, tolerating an already-absent file. */
export async function clearCredential(path) {
    try {
        await rm(path, { force: true });
    }
    catch (error) {
        if (!isMissing(error))
            throw error;
    }
}
function isMissing(error) {
    return typeof error === 'object'
        && error !== null
        && error.code === 'ENOENT';
}
//# sourceMappingURL=store.js.map