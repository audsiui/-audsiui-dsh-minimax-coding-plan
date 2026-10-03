/**
 * Standalone sign-in for the MiniMax Coding Plan grant.
 *
 * The plugin owns the credential but nothing in the harness yet calls
 * `MinimaxAccount.signIn()` — a settings button needs a browser half-side
 * (`./client` + `ctx.slots.register`), and the `clientBundle` tsdown preset
 * that builds one is not published. This script closes that gap without
 * duplicating any logic: it drives the very functions `runSignIn()` drives,
 * imported from the built artifact, and writes the grant to the same path the
 * plugin's `defaultCredentialsPath()` resolves to. The plugin then picks it up
 * on its next operation — no reinstall, no restart.
 *
 * Usage:
 *   node signin.mjs            # cn region, opens a browser
 *   node signin.mjs en         # io region
 *   node signin.mjs cn --no-browser
 */
import { spawn } from 'node:child_process'
import {
  defaultCredentialsPath,
  endpointsFor,
  pollDeviceToken,
  requestDeviceAuthorization,
  writeCredential,
} from './lib/index.js'

const region = process.argv[2] === 'en' ? 'en' : 'cn'
const openBrowser = !process.argv.includes('--no-browser')
const credentialsPath = defaultCredentialsPath()

const open = (url) => {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
  }
  catch {
    // A headless box has no browser; the printed URL is the fallback.
  }
}

const endpoints = endpointsFor(region)
console.log(`MiniMax Coding Plan sign-in (${region})`)
console.log(`  account:    ${endpoints.accountOrigin}`)
console.log(`  inference:  ${endpoints.inferenceOrigin}`)
console.log(`  credential: ${credentialsPath}`)
console.log()

const authorization = await requestDeviceAuthorization(endpoints)
const url = authorization.verificationUriComplete ?? authorization.verificationUri
console.log(`Open this page and approve the request:`)
console.log(`  ${url}`)
console.log(`  code ${authorization.userCode}  (valid ${authorization.expiresInSec}s)`)
console.log()
if (openBrowser) open(url)
else console.log('(--no-browser: opening it yourself)')

const grant = await pollDeviceToken(endpoints, authorization)
await writeCredential(credentialsPath, grant, region)

console.log()
console.log('Signed in.')
console.log(`  account:  ${grant.accountId ?? '(not reported)'}`)
console.log(`  scopes:   ${grant.scopes.join(', ')}`)
console.log(`  expires:  ${new Date(grant.expiresAtMs).toISOString()}`)
console.log()
console.log('The provider refreshes this grant on its own; nothing else to do.')
