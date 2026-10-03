/**
 * Account service owning the MiniMax credential: one interactive device
 * authorization, then a self-refreshing access token.
 */
import { spawn } from 'node:child_process'
import { Context, Service } from '@deepseek-ai/cordis'
import { TOKEN_REFRESH_MARGIN_MS, type RegionEndpoints } from './constants.ts'
import {
  OAuthProtocolError,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceAuthorization,
  revokeRefreshToken,
  type DeviceAuthorization,
  type OAuthClientOptions,
} from './oauth.ts'
import { clearGrant, readGrant, writeGrant } from './grant.ts'
import { type StoredCredential } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A new device grant was committed. @mode emit */
    'minimax-account/authenticated'(): void
    /** Local credential removal has completed. @mode emit */
    'minimax-account/signed-out'(): void
  }
  interface Context {
    minimaxAccount: MinimaxAccount
  }
}

/** Observable account state, carrying no credential material. */
export type MinimaxAccountState =
  | { readonly status: 'signed-out' }
  | {
    readonly status: 'authorizing'
    readonly userCode: string
    readonly verificationUri: string
    readonly verificationUriComplete: string | undefined
    readonly expiresInSec: number
  }
  | { readonly status: 'authenticated'; readonly accountId: string | undefined; readonly expiresAtMs: number }

/** Collaborators and settings the account needs from its host. */
export interface MinimaxAccountOptions {
  /** Region origins this login is bound to. */
  readonly endpoints: RegionEndpoints
  /** Region name, recorded alongside the stored grant. */
  readonly region: string
  /** Absolute path of the credential file. */
  readonly credentialsPath: string
  /** Open the verification page in the operator's browser. */
  readonly openBrowser?: boolean
  /** Injectable transport, clock, and sleep for tests. */
  readonly client?: OAuthClientOptions
}

/**
 * MiniMax Coding Plan credentials.
 *
 * The service hands out a token only for the inference origin it was
 * configured with, so a misrouted request cannot leak the grant to a host
 * that happens to receive the header.
 */
export class MinimaxAccount extends Service {
  // Declared with TypeScript `private`, not ES `#private`: a Cordis `Service` is
  // handed out through a tracking proxy, and native private fields are not
  // reachable from a proxy that wraps the instance.
  private readonly options: MinimaxAccountOptions
  private state: MinimaxAccountState = { status: 'signed-out' }
  private signInAttempt: Promise<MinimaxAccountState> | undefined
  private refreshInFlight: Promise<StoredCredential> | undefined

  /** @param ctx - context owning this account. @param options - endpoints, storage, and test seams. */
  constructor(ctx: Context, options: MinimaxAccountOptions) {
    super(ctx, 'minimaxAccount')
    this.options = options
  }

  /** Read the current account state. */
  getState(): MinimaxAccountState {
    return this.state
  }

  /**
   * Sign in through the device-authorization grant, or join the attempt
   * already running. The first caller owns the browser prompt and the polling
   * loop; later callers await the same outcome.
   * @returns the state after the attempt settles.
   */
  async signIn(): Promise<MinimaxAccountState> {
    this.signInAttempt ??= this.runSignIn().finally(() => {
      this.signInAttempt = undefined
    })
    return this.signInAttempt
  }

  /**
   * Resolve a usable access token, refreshing it when it is close to expiry.
   *
   * Concurrent callers share one refresh so a burst of parallel turns issues
   * a single token request.
   *
   * @param url - the request destination or the configured inference base URL.
   * @returns the bearer token, or undefined when signed out or the URL is not the allowed origin.
   */
  async resolveToken(url: string): Promise<string | undefined> {
    if (!this.isAllowedOrigin(url)) return undefined
    const stored = await readGrant(this.ctx, this.options.credentialsPath)
    if (!stored) return undefined
    if (stored.region !== this.options.region) return undefined

    const now = (this.options.client?.now ?? Date.now)()
    if (stored.expiresAtMs - now > TOKEN_REFRESH_MARGIN_MS) {
      this.state = { status: 'authenticated', accountId: stored.accountId, expiresAtMs: stored.expiresAtMs }
      return stored.accessToken
    }
    return (await this.refreshStored(stored)).accessToken
  }

  /**
   * Drop a token the inference endpoint rejected.
   *
   * Only clears when the rejected token is still the stored one, so a late
   * 401 from a superseded login never signs out the current session.
   *
   * @param token - token captured by the rejected request.
   */
  async rejectToken(token: string): Promise<void> {
    const stored = await readGrant(this.ctx, this.options.credentialsPath)
    if (!stored || stored.accessToken !== token) return
    this.refreshInFlight = undefined
    await clearGrant(this.ctx, this.options.credentialsPath)
    this.state = { status: 'signed-out' }
    this.ctx.emit('minimax-account/signed-out')
  }

  /**
   * Revoke and remove the local grant. Local state is cleared even when the
   * revocation request fails, so sign-out always takes effect.
   */
  async signOut(): Promise<MinimaxAccountState> {
    this.refreshInFlight = undefined
    const stored = await readGrant(this.ctx, this.options.credentialsPath)
    if (stored) {
      try {
        await revokeRefreshToken(this.options.endpoints, stored.refreshToken, this.options.client)
      }
      catch (error) {
        this.ctx.logger.warn('minimax-account: revocation failed; removing the local grant anyway: %o', error)
      }
    }
    await clearGrant(this.ctx, this.options.credentialsPath)
    this.state = { status: 'signed-out' }
    this.ctx.emit('minimax-account/signed-out')
    return this.state
  }

  /** Run one device authorization end to end. */
  private async runSignIn(): Promise<MinimaxAccountState> {
    const client = this.options.client
    let authorization: DeviceAuthorization
    try {
      authorization = await requestDeviceAuthorization(this.options.endpoints, client)
    }
    catch (error) {
      this.state = { status: 'signed-out' }
      throw error
    }

    this.state = {
      status: 'authorizing',
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
      verificationUriComplete: authorization.verificationUriComplete,
      expiresInSec: authorization.expiresInSec,
    }
    this.ctx.logger.info(
      'minimax-account: open %s and enter code %s to finish sign-in (valid for %ds)',
      authorization.verificationUriComplete ?? authorization.verificationUri,
      authorization.userCode,
      authorization.expiresInSec,
    )
    if (this.options.openBrowser !== false) {
      openExternal(authorization.verificationUriComplete ?? authorization.verificationUri)
    }

    try {
      const grant = await pollDeviceToken(this.options.endpoints, authorization, client)
      await writeGrant(this.ctx, this.options.credentialsPath, grant, this.options.region)
      this.state = { status: 'authenticated', accountId: grant.accountId, expiresAtMs: grant.expiresAtMs }
      this.ctx.emit('minimax-account/authenticated')
      return this.state
    }
    catch (error) {
      this.state = { status: 'signed-out' }
      throw error
    }
  }

  /** Refresh one stored grant, collapsing concurrent callers onto one request. */
  private async refreshStored(stored: StoredCredential): Promise<StoredCredential> {
    this.refreshInFlight ??= (async () => {
      try {
        const grant = await refreshAccessToken(this.options.endpoints, stored.refreshToken, this.options.client)
        await writeGrant(this.ctx, this.options.credentialsPath, grant, this.options.region)
        const next: StoredCredential = {
          schemaVersion: 1,
          clientId: stored.clientId,
          accessToken: grant.accessToken,
          refreshToken: grant.refreshToken,
          expiresAtMs: grant.expiresAtMs,
          scopes: grant.scopes,
          accountId: grant.accountId,
          subject: grant.subject,
          region: this.options.region,
        }
        this.state = { status: 'authenticated', accountId: next.accountId, expiresAtMs: next.expiresAtMs }
        return next
      }
      catch (error) {
        // A terminal rejection (invalid_grant, revoked authorization) leaves a
        // refresh token that can never succeed again; retire it so the next
        // request asks the operator to sign in rather than looping.
        if (error instanceof OAuthProtocolError && error.httpStatus !== undefined && error.httpStatus < 500) {
          await clearGrant(this.ctx, this.options.credentialsPath)
          this.state = { status: 'signed-out' }
        }
        throw error
      }
      finally {
        this.refreshInFlight = undefined
      }
    })()
    return this.refreshInFlight
  }

  /**
   * Accept only the configured inference origin.
   *
   * Comparing parsed URL components rather than prefixes rejects lookalikes
   * such as `https://agent.minimax.cn.evil.test`, a non-HTTPS scheme, an
   * explicit port, and embedded credentials.
   */
  private isAllowedOrigin(url: string): boolean {
    let candidate: URL
    let allowed: URL
    try {
      candidate = new URL(url)
      allowed = new URL(this.options.endpoints.inferenceOrigin)
    }
    catch {
      return false
    }
    return candidate.protocol === 'https:'
      && candidate.host === allowed.host
      && candidate.username === ''
      && candidate.password === ''
      && candidate.port === ''
      && candidate.origin === allowed.origin
  }
}

/** Open a URL with the platform's default handler; failures are non-fatal. */
export function openExternal(url: string): void {
  let command: string
  let args: string[]
  if (process.platform === 'win32') {
    // The empty-string title keeps `start` from reading the URL as a window
    // title; `windowsHide` and a detached child keep a console from flashing.
    command = 'cmd'
    args = ['/c', 'start', '', url]
  }
  else if (process.platform === 'darwin') {
    command = 'open'
    args = [url]
  }
  else {
    command = 'xdg-open'
    args = [url]
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  }
  catch {
    // A headless host has no browser; the logged URL and code are enough.
  }
}

export default MinimaxAccount
