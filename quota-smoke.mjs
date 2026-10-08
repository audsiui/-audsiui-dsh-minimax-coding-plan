// Live probe of the plan-quota endpoint through the plugin's own reader.
// A deliberately bogus grant must come back as QuotaAuthError: that proves the
// URL resolves and the request is well-formed enough for the service to evaluate
// the token. A 404 or a network error would mean the path or the header shape is
// wrong.
//
// The code is 1016, not the 1004 an earlier version of this file expected. The
// distinction it assumed — a missing credential reported separately from a
// rejected one — was probed against the live endpoint and does not exist: an
// absent header, an empty one and two garbage bearers all answer 1016.
import { REGION_ENDPOINTS } from './lib/index.js'
import { fetchQuota, QuotaAuthError, QuotaNetworkError } from './lib/types/testing.js'

try {
  const snapshot = await fetchQuota({
    origin: REGION_ENDPOINTS.cn.quotaOrigin,
    token: 'not-a-real-token',
  })
  console.log('UNEXPECTED: a bogus grant returned data', JSON.stringify(snapshot))
  process.exit(1)
}
catch (error) {
  if (error instanceof QuotaAuthError) {
    console.log(`OK  endpoint reached and evaluated the credential -> ${error.statusCode} "${error.message}"`)
    process.exit(0)
  }
  if (error instanceof QuotaNetworkError) {
    console.log(`BAD  ${error.message}`)
    process.exit(1)
  }
  console.log(`BAD  unexpected ${error?.name}: ${error?.message}`)
  process.exit(1)
}
