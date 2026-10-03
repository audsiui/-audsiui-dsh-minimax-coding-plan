/**
 * A local console for sign-in, sign-out, and plan usage.
 *
 * The harness GUI cannot be extended by a third-party package — its client
 * half reaches the host only through generated Remote contributions, which
 * dsh's own build pipeline produces for its own packages — so the operator-
 * facing surface lives here instead: a loopback HTTP listener holding one
 * page and four endpoints.
 *
 * Three things keep a listener that can start a login safe on a shared
 * machine. It binds `127.0.0.1` explicitly, so it is not reachable from the
 * network at all. Every path is prefixed with a per-process random secret, so
 * a page the operator happens to be visiting cannot guess the entry point even
 * if something managed to issue a request from this origin. And every request
 * must carry a `Host` naming loopback, which closes DNS rebinding: a name an
 * attacker controls, resolving to 127.0.0.1, still fails the check.
 */
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import { MinimaxAccount, type MinimaxAccountState } from './account.ts'
import type { RegionEndpoints } from './constants.ts'
import { renderConsolePage } from './page.ts'
import { fetchQuota, QuotaAuthError, type QuotaSnapshot } from './quota.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    minimaxConsole: MinimaxConsole
  }
}

/** Loopback authorities a request may name, with or without the port. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** What the console renders in one poll. */
export interface ConsoleState {
  /** Never carries credential material — only what the page may display. */
  readonly status: 'signed-out' | 'authorizing' | 'authenticated'
  readonly userCode?: string | undefined
  readonly verificationUri?: string | undefined
  readonly verificationUriComplete?: string | undefined
  readonly expiresInSec?: number | undefined
  readonly accountId?: string | undefined
  readonly expiresAtMs?: number | undefined
  readonly region: string
  readonly quota?: QuotaSnapshot | undefined
  readonly quotaError?: string | undefined
}

/** Collaborators and settings for the console. */
export interface MinimaxConsoleOptions {
  /** The credential the buttons act on. */
  readonly account: MinimaxAccount
  /** Region origins, used for the usage read. */
  readonly endpoints: RegionEndpoints
  /** Region name, displayed on the page. */
  readonly region: string
  /** Fixed port, or 0 for an ephemeral one. Defaults to 0. */
  readonly port?: number
  /** Injectable transport and clock, passed through to the quota read. */
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
}

/** Flatten the account's discriminated state into the wire shape. */
function toWire(state: MinimaxAccountState, region: string): Omit<ConsoleState, 'quota' | 'quotaError'> {
  if (state.status === 'authorizing') {
    return {
      status: 'authorizing',
      userCode: state.userCode,
      verificationUri: state.verificationUri,
      verificationUriComplete: state.verificationUriComplete,
      expiresInSec: state.expiresInSec,
      region,
    }
  }
  if (state.status === 'authenticated') {
    return {
      status: 'authenticated',
      accountId: state.accountId,
      expiresAtMs: state.expiresAtMs,
      region,
    }
  }
  return { status: 'signed-out', region }
}

/** Reject anything not addressed to this loopback listener. */
function isLoopbackHost(req: IncomingMessage): boolean {
  const raw = req.headers.host
  if (!raw) return false
  // Strip the port; an IPv6 literal keeps its brackets.
  const host = raw.startsWith('[')
    ? raw.slice(0, raw.indexOf(']') + 1)
    : (raw.split(':')[0] ?? '')
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

/**
 * The console's HTTP listener.
 *
 * Exposed as a service so the harness owns its lifetime: disabling the plugin
 * closes the socket, and an unreachable console is the intended failure mode.
 */
export class MinimaxConsole extends Service {
  // TypeScript `private`, not ES `#private`: a Cordis `Service` is handed out
  // through a tracking proxy that cannot reach native private fields.
  private readonly options: MinimaxConsoleOptions
  private readonly secret: string
  private server: Server | undefined
  private port = 0

  /** @param ctx - context owning this listener. @param options - account, origins, and port. */
  constructor(ctx: Context, options: MinimaxConsoleOptions) {
    super(ctx, 'minimaxConsole')
    this.options = options
    this.secret = randomBytes(24).toString('base64url')
  }

  /**
   * Bind the listener and log the entry URL.
   *
   * The URL is logged rather than opened: opening it unattended would leave a
   * signed-in console tab behind on every host start.
   *
   * @returns the URL the operator should open, or undefined when the port is
   * unavailable — a busy port is not worth failing plugin load over.
   */
  async start(): Promise<string | undefined> {
    if (this.server) return this.url()

    const server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        this.ctx.logger.error('minimax-console: request failed: %o', error)
        if (!res.headersSent) json(res, 500, { error: 'the console request failed' })
      })
    })

    const port = await new Promise<number | undefined>((resolve) => {
      server.once('error', (error: unknown) => {
        this.ctx.logger.warn('minimax-console: could not listen: %o', error)
        resolve(undefined)
      })
      server.listen(this.options.port ?? 0, '127.0.0.1', () => {
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : undefined)
      })
    })

    if (port === undefined) {
      server.close()
      return undefined
    }
    this.server = server
    this.port = port
    this.ctx.logger.info('minimax-console: open %s', this.url())
    return this.url()
  }

  /** The tokenised console URL. */
  url(): string {
    return `http://127.0.0.1:${this.port}/${this.secret}/`
  }

  /** Release the socket when the fiber is torn down. */
  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = undefined
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }

  /** Route one request, or refuse it. */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopbackHost(req)) {
      res.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('this listener only answers loopback requests\n')
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const base = `/${this.secret}/`
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found\n')
      return
    }
    const route = url.pathname.slice(base.length)

    if (req.method === 'GET' && route === '') {
      const html = renderConsolePage(base)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // The page is entirely inline; deny it every ambient capability.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      })
      res.end(html)
      return
    }

    if (req.method === 'GET' && route === 'api/state') {
      json(res, 200, await this.state())
      return
    }

    if (req.method === 'POST' && (route === 'api/sign-in' || route === 'api/sign-out')) {
      await this.readBody(req)
      if (route === 'api/sign-in') this.beginSignIn()
      else await this.options.account.signOut()
      json(res, 200, await this.state())
      return
    }

    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, POST' })
    res.end('method not allowed\n')
  }

  /**
   * Start a sign-in without waiting for it.
   *
   * The device grant takes as long as the operator takes to approve it, so the
   * request returns as soon as the attempt is under way and the page polls
   * `api/state` until the status settles. `MinimaxAccount.signIn` already
   * collapses concurrent callers onto one attempt, so a double click is safe.
   */
  private beginSignIn(): void {
    this.options.account.signIn().catch((error: unknown) => {
      // Approval timeouts and transport failures are expected outcomes here;
      // the state the page polls already reflects the failure, so this only
      // needs to leave a trace for the operator reading the log.
      this.ctx.logger.warn('minimax-console: sign-in attempt ended: %o', error)
    })
  }

  /** Assemble one poll: account state, plus quota when a grant is usable. */
  private async state(): Promise<ConsoleState> {
    const state = this.options.account.getState()
    const base = toWire(state, this.options.region)
    if (state.status !== 'authenticated') return base

    const token = await this.options.account.resolveToken(this.options.endpoints.quotaOrigin)
    if (token === undefined) return base
    try {
      const quota = await fetchQuota({
        token,
        endpoints: this.options.endpoints,
        fetchImpl: this.options.fetchImpl,
        now: this.options.now,
      })
      return { ...base, quota }
    }
    catch (error) {
      // A rejected grant is worth distinguishing: the page should offer
      // sign-in again rather than looking like a network blip.
      if (error instanceof QuotaAuthError) {
        this.ctx.logger.warn('minimax-console: usage read rejected the grant (%d): %s', error.statusCode, error.message)
        return { ...base, quotaError: '登录状态已失效，请重新登录。' }
      }
      this.ctx.logger.warn('minimax-console: usage read failed: %o', error)
      return { ...base, quotaError: `读取用量失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** Consume a request body, refusing anything oversized. */
  private async readBody(req: IncomingMessage): Promise<void> {
    const limit = 4096
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > limit) throw new Error('request body too large')
    }
  }
}

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}
