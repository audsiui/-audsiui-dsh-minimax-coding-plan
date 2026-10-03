// Live probe of the plan-quota endpoint through the plugin's own client.
// A deliberately bogus grant must come back as QuotaAuthError(1004): that
// proves the URL resolves and the request is well-formed enough for the
// service to evaluate the token. A 404 or a network error would mean the
// path or the header shape is wrong.
import { fetchQuota, QuotaAuthError, QuotaNetworkError, REGION_ENDPOINTS } from './lib/index.js'

try {
  const snapshot = await fetchQuota({
    token: 'not-a-real-token',
    endpoints: REGION_ENDPOINTS.cn,
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
