// Probe the real MiniMax device-authorization endpoints and report the *shapes*
// they actually return.
//
// The sign-in path validates a token response against four conditions this
// client assumed rather than observed (see parseTokenGrant). A pending poll
// cannot show the success shape — that needs a human to approve a code — but it
// does show the envelope, the pending signal, and the field naming convention the
// same server uses on the code request, which is enough to tell an assumed field
// name from a real one.
//
// Usage: node probe-device-flow.mjs
import { createHash, randomBytes } from 'node:crypto'

const CLIENT_ID = 'mcode-public'
const SCOPE = 'agent.default'
const AUDIENCE = 'agent-backend'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const ORIGIN = 'https://account.minimax.cn'

const shape = (value, depth = 0) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') {
    if (depth > 0) return `{${Object.keys(value).sort().join(', ')}}`
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, shape(value[key], depth + 1)]),
    )
  }
  if (typeof value === 'string') return value.length > 12 ? `string(${value.length})` : JSON.stringify(value)
  return String(value)
}

async function post(path, values) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  })
  let body
  try { body = await response.json() } catch { body = undefined }
  return { status: response.status, ok: response.ok, body }
}

const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')

const code = await post('/oauth2/device/code', {
  client_id: CLIENT_ID,
  scope: SCOPE,
  audience: AUDIENCE,
  code_challenge: challenge,
  code_challenge_method: 'S256',
})
console.log('=== POST /oauth2/device/code ->', code.status, code.ok ? 'ok' : 'not ok')
console.log(JSON.stringify(shape(code.body), null, 2))

if (!code.body?.device_code) {
  console.log('\nno device_code; nothing further to probe')
  process.exit(1)
}
console.log('\nuser_code     :', code.body.user_code)
console.log('verification  :', code.body.verification_uri_complete ?? code.body.verification_uri)

// Poll a few times at the cadence the server asked for. The interval is not
// optional: an earlier version of this probe fired back-to-back, and the second
// poll came back `400 {"error":"slow_down"}` — a rate-limit verdict, not the
// pending signal the loop was written to observe. That made the run's own
// comment ("Pending is the expected answer") wrong about its own output.
const INTERVAL_MS = (typeof code.body.interval === 'number' && code.body.interval > 0
  ? code.body.interval
  : 5) * 1000
const ATTEMPTS = 3

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  if (attempt > 1) await new Promise(resolve => setTimeout(resolve, INTERVAL_MS))
  const token = await post('/oauth2/token', {
    grant_type: DEVICE_GRANT,
    device_code: code.body.device_code,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  })
  console.log(`\n=== POST /oauth2/token (poll ${attempt}, after ${INTERVAL_MS}ms) ->`, token.status, token.ok ? 'ok' : 'not ok')
  console.log(JSON.stringify(shape(token.body), null, 2))
  if (token.ok && token.body?.access_token) {
    console.log('\nA token came back without a human approving — inspect the shape above.')
    break
  }
  if (token.body?.error !== 'authorization_pending' && token.body?.status !== 'pending') break
}

console.log('\nApprove', code.body.user_code, 'at', code.body.verification_uri_complete ?? code.body.verification_uri,
  'to see the success shape. This probe is read-only and grants nothing.')
