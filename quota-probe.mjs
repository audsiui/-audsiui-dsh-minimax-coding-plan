// Which credential header does /backend/account/token_plan/* actually read?
// Each probe sends a deliberately bogus value, so the service can only answer
// "that credential is not valid" — but *which* code it answers with tells us
// which header it consumed. No real grant is involved.
import { REGION_ENDPOINTS } from './lib/index.js'

const url = `${REGION_ENDPOINTS.cn.quotaOrigin}/backend/account/token_plan/remains_percent`
const BOGUS = 'not-a-real-token'

const PROBES = [
  ['no credential header', {}],
  ['token: <v>', { token: BOGUS }],
  ['Authorization: Bearer <v>', { authorization: `Bearer ${BOGUS}` }],
  ['x-api-key: <v>', { 'x-api-key': BOGUS }],
  ['api-key: <v>', { 'api-key': BOGUS }],
  ['token + Authorization', { token: BOGUS, authorization: `Bearer ${BOGUS}` }],
  ['token + x-timestamp + x-signature', {
    token: BOGUS,
    'x-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-signature': '0'.repeat(32),
  }],
]

for (const [label, extra] of PROBES) {
  let verdict
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...extra },
    })
    const text = await res.text()
    let code = '?'
    let msg = ''
    try {
      const parsed = JSON.parse(text)
      code = String(parsed?.base_resp?.status_code)
      msg = String(parsed?.base_resp?.status_msg ?? '')
    }
    catch {
      verdict = `HTTP ${res.status} non-JSON (${text.slice(0, 60).replace(/\s+/g, ' ')})`
    }
    if (!verdict) verdict = `HTTP ${res.status} base_resp ${code} "${msg}"`
  }
  catch (error) {
    verdict = `network: ${error.message}`
  }
  console.log(`${label.padEnd(34)} ${verdict}`)
}
