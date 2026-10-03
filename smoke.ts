/** Live smoke test for the pure modules: real endpoints, no harness graph. */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REGION_ENDPOINTS } from './src/constants.ts'
import {
  OAuthProtocolError,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceAuthorization,
  revokeRefreshToken,
} from './src/oauth.ts'
import { readCredential, writeCredential, clearCredential } from './src/store.ts'

const endpoints = REGION_ENDPOINTS.cn
let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

console.log('--- 1. device authorization against the live account origin ---')
const authorization = await requestDeviceAuthorization(endpoints)
check('returns a device code', typeof authorization.deviceCode === 'string' && authorization.deviceCode.length > 0)
check('returns a 9-char user code', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(authorization.userCode), authorization.userCode)
check('verification_uri is the account origin', authorization.verificationUri.startsWith(endpoints.accountOrigin), authorization.verificationUri)
check('verification_uri_complete embeds the code', authorization.verificationUriComplete?.includes(authorization.userCode) === true)
check('lifetime is finite', authorization.expiresInSec > 0 && authorization.expiresInSec <= 3600, `${authorization.expiresInSec}s`)
check('poll interval is sane', authorization.intervalSec >= 1, `${authorization.intervalSec}s`)
check('PKCE verifier is base64url 43 chars', /^[A-Za-z0-9_-]{43}$/.test(authorization.codeVerifier))

console.log('\n--- 2. one poll against an unapproved grant ---')
// Count real HTTP requests, and advance the clock past the deadline so a
// no-op `sleep` cannot spin this loop against the live endpoint.
let polls = 0
const startedAt = Date.now()
const countingFetch: typeof fetch = async (...args) => {
  polls++
  return fetch(...args)
}
try {
  await pollDeviceToken(endpoints, authorization, {
    fetchImpl: countingFetch,
    sleep: async () => {},
    // Hold still until the first request has gone out, then jump past the
    // deadline so the loop cannot issue a second one.
    now: () => startedAt + (polls > 0 ? 10_000_000 : 0),
  })
  check('unapproved poll does not fabricate a token', false, 'it unexpectedly returned a grant')
}
catch (error) {
  const code = error instanceof OAuthProtocolError ? error.code : 'unexpected'
  check('unapproved poll does not fabricate a token',
    code === 'authorization_pending' || code === 'expired_token' || code === 'access_denied',
    `code=${code}`)
}
check('poll issued exactly one request', polls === 1, `requests=${polls}`)

console.log('\n--- 3. refresh rejects a bogus refresh token with a server code ---')
try {
  await refreshAccessToken(endpoints, 'definitely-not-a-real-refresh-token')
  check('bogus refresh is rejected', false, 'it unexpectedly succeeded')
}
catch (error) {
  const code = error instanceof OAuthProtocolError ? error.code : 'unexpected'
  check('bogus refresh is rejected with an OAuth error', error instanceof OAuthProtocolError, `code=${code}`)
}

console.log('\n--- 4. revoke tolerates the undeployed production route ---')
// account.minimax.cn answers 404 here; sign-out must still complete.
try {
  await revokeRefreshToken(endpoints, 'definitely-not-a-real-refresh-token')
  check('revoke is a no-op when the route is absent', true)
}
catch (error) {
  check('revoke is a no-op when the route is absent', false, String(error))
}

console.log('\n--- 5. token store round-trip and validation ---')
const dir = await mkdtemp(join(tmpdir(), 'minimax-store-'))
const path = join(dir, 'credential.json')
check('missing file reads as signed out', await readCredential(path) === undefined)

await writeCredential(path, {
  accessToken: 'at-1',
  refreshToken: 'rt-1',
  expiresAtMs: 1_900_000_000_000,
  scopes: ['agent.default'],
  accountId: 'acct-1',
  subject: 'sub-1',
}, 'cn')
const stored = await readCredential(path)
check('round-trips the grant', stored?.accessToken === 'at-1' && stored?.refreshToken === 'rt-1')
check('keeps the region', stored?.region === 'cn')
check('keeps the account id', stored?.accountId === 'acct-1')

await writeFile(path, '{ truncated', 'utf8')
check('a corrupt file reads as signed out', await readCredential(path) === undefined)

await writeFile(path, JSON.stringify({ schemaVersion: 1, clientId: 'someone-else', accessToken: 'a', refreshToken: 'b', expiresAtMs: 1, scopes: ['agent.default'] }), 'utf8')
check('a foreign client id is refused', await readCredential(path) === undefined)

await writeFile(path, JSON.stringify({ schemaVersion: 1, clientId: 'mcode-public', accessToken: 'a', refreshToken: 'b', expiresAtMs: 1, scopes: ['other.scope'] }), 'utf8')
check('a token missing the required scope is refused', await readCredential(path) === undefined)

await clearCredential(path)
check('clear removes the record', await readCredential(path) === undefined)
check('clear on an absent file is a no-op', await clearCredential(path) === undefined)
console.log('  raw file mode is best-effort on Windows; contents verified above')

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
