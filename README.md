# `@audsiui/dsh-minimax-coding-plan`

MiniMax Coding Plan provider for DeepSeek Harness, authenticated with MiniMax's
own OAuth device-authorization grant.

Two facts drive the whole design:

1. **The endpoint is Anthropic Messages.** `POST {inferenceOrigin}/v1/messages`
   answers with the standard Anthropic error envelope, while
   `/chat/completions` and `/responses` return
   `direct_route_not_configured`. There is no OpenAI-compatible route here, so
   this plugin reuses the Messages transport from `@deepseek-ai/dsh-llm-deepseek`
   instead of shipping a second SSE parser.
2. **Only `Authorization: Bearer` is required.** The `yy` / `x-timestamp` /
   `x-signature` headers MiniMax's own client sends belong to the *web and
   business* APIs on the same host (`/v1/api/...`, `/matrix/api/...`,
   `/minimax-cloud/api/...`). The inference gateway does not check them.

The only thing this plugin therefore owns is the credential.

## Wire contract

All three steps are `POST` with
`Content-Type: application/x-www-form-urlencoded` and `Accept: application/json`.

| Step | Endpoint | Fields |
| --- | --- | --- |
| Device code | `{accountOrigin}/oauth2/device/code` | `client_id`, `scope`, `audience`, `code_challenge`, `code_challenge_method` |
| Token | `{accountOrigin}/oauth2/token` | `grant_type`, `device_code` \| `refresh_token`, `client_id`, `code_verifier` |
| Revoke | `{accountOrigin}/oauth2/revoke` | `token`, `token_type_hint`, `client_id` — **404, see below** |

Fixed values, not configurable: `client_id=mcode-public`, `scope=agent.default`,
`audience=agent-backend`. `mcode-public` is a **public client** — there is no
client secret, and PKCE (`S256`) is the only binding.

| Region | Account origin | Messages origin | Quota origin |
| --- | --- | --- | --- |
| `cn` | `https://account.minimax.cn` | `https://agent.minimax.cn/mavis/api/v1/llm` | `https://www.minimaxi.com` |
| `en` | `https://account.minimax.io` | `https://agent.minimax.io/mavis/api/v1/llm` | `https://platform.minimax.io` |

The quota origin is the open platform, **not** the account origin. `/backend/…`
routes do not exist on `account.minimax.cn` — they answer with the account
site's Next.js `404` page, which reads as "not deployed" if you only look at
the status code.

### Revocation is not deployed

`/oauth2/revoke` is referenced by MiniMax's own desktop client but answers
`404 page not found` on both production origins, for both `POST` and `GET`
(verified 2026-10-03). `revokeRefreshToken()` therefore treats `404`/`405` as
"already unusable" and returns cleanly, so sign-out always completes. Any other
failure still propagates. The practical consequence: **signing out removes the
local credential but does not invalidate the refresh token server-side.**

## Configuration

`cordis.patch.yml` ships the defaults below. Override them in the profile's own
`cordis.patch.yml` (or a `--patch` overlay), which is applied after this layer:

```yaml
- id: llm-minimax-coding-plan
  config:                        # a patch replaces the whole config
    region: cn                   # cn | en
    # baseURL: https://agent.minimax.cn/mavis/api/v1/llm   # must NOT end in /v1
    # credentialsPath: ~/.dsh/minimax-coding-plan/credential.json
    # openBrowser: true
    # consolePort: 0                 # 0 = pick a free port; the URL is logged at startup
    models:                      # required: there is no discovery route
      - id: MiniMax-M3.1-Flash-Preview
        name: MiniMax M3.1 Flash (Preview)
        inputModalities: [text, image]
        # imagePixelBudget: low    # optional; omitted means the transport's own grid
        # imageMaxBytes: 2097152   # optional; omitted means the transport's own 2 MiB
```

### Image input

The route is the Anthropic Messages protocol and this model takes images, so the
shipped catalog says so. That one declaration is the entire switch: the shared
transport refuses an image for a route whose catalog does not list `image`, so a
text-only catalog quietly projects every picture into text instead of failing.

No MiniMax-specific image limits are declared, because none have been measured.
`imagePixelBudget` and `imageMaxBytes` stay on the transport's own defaults — its
published token grid as the projection, and 2 MiB as the encoded-byte ceiling.
Both are settable per entry once the real limits are known, and the protocol's
own rule still applies: an entry that lists only `text` cannot declare either.

Two transport behaviours worth knowing on this route. Images are sent inline as
base64, but the Files API is attempted first and falls back on failure — MiniMax
has no `/files`, so an image costs one wasted round trip before it is sent. And
images are accepted in user messages and tool results only.

Inspect the merged result without starting a session:

```sh
dsh --profile demo --dump-config   # shows a "# == @audsiui/dsh-minimax-coding-plan" layer
```

Then select the route in the model picker as `minimax-coding-plan/<model-id>`.
The route stays hidden from discovery until a credential is stored, so an
unsigned harness does not advertise models it cannot call.

The first request before sign-in fails with `ACCOUNT_SIGN_IN_REQUIRED`.

## Signing in

The grant is offered as a harness **authorization flow** — `ctx.authorization`
is the seam the harness documents for a credential nobody can supply from
configuration alone, because getting it takes a conversation with a human. It
owns the attempt: one per key, cancellable, and it refuses to report success
unless a record was actually committed. This plugin owns only the protocol,
which is the split that seam asks for.

The flow reports the verification page through `session.notify({ url, code })`,
so any surface that renders one flow renders this one, and the agent-facing
`ctx.authorization` API can drive it too.

The grant lives in `ctx.credentials` as a `GrantRecord` whose payload only this
plugin interprets. The harness stores it at `$DSH_HOME/.credentials.yaml`
through its local provider.

`signin.mjs` remains the script path, and it needs no harness at all:

```sh
node signin.mjs            # cn region, opens a browser
node signin.mjs en         # io region
node signin.mjs cn --no-browser
```

Both write the same record — the script to the legacy JSON file, which the
account still reads as a fallback — so a credential obtained either way keeps
working across the change, and the provider refreshes it on its own from then
on.

### Why the buttons live on a local page, not in the harness UI

This plugin cannot put a sign-in button inside the DeepSeek Harness window,
and the reason is structural rather than incidental. A harness client plugin
(`dsh.client` plus a slot such as `plugins.detail.actions`) can render
whatever it likes, but it has no sanctioned way to reach *this* process's
services. The only documented host channel is the Typert Remote API
(`ctx.remote.<namespace>`), and reaching it needs both halves of a build-time
contract that a third-party package cannot satisfy:

- `api-gateway.zh.md` documents that the Typert generator runs inside dsh's
  own root build, where both tsdown passes match only `vendor/*`,
  `packages/*/*`, `apps/cli`, and `apps/desktop-host`. A package installed from
  git lives in `node_modules` and is never in that set, so no `typert.host.js`
  or `typert.remote-client.js` is ever generated for it.
- The same document states that mounting a contribution is "an explicit choice
  of the Client composition owner" — the shipped app's `dsh-api-remotes`
  assembly, which a plugin author cannot edit.
- The source-mode fallback is not a way around it. `api-gateway.zh.md` is
  explicit that SRC descriptors only solve *Host* dispatch, and that the client
  refuses to mount a descriptor lacking a strict generated codec.
- The escape hatch — registering an exact Connection Fetch route — does not
  exist in the desktop app: `web-server.zh.md` states the HTTP server serves
  browsers only, and Electron loads over `file://` and sends its fetches
  through an IPC bridge.

So the surface is a loopback page this plugin serves itself. What that costs:
it is a separate tab, not a panel in the harness window.

## The console

With the plugin enabled, the host logs a URL at startup:

```text
minimax-console: open http://127.0.0.1:6173/4qwWUb9jlGxUc2Z118uic2jkoHF94w3b/
```

That page carries the sign-in button, the sign-out button, and the usage
readout with a **本周期 / 本周** toggle. It is served by `MinimaxConsole`, a
Cordis service, so disabling the plugin closes the socket.

Three independent guards, because a listener that can start a login should not
be reachable by anything the operator merely visits:

- It binds `127.0.0.1` explicitly, so it is not on the network at all.
- Every path is prefixed with a 24-byte random secret generated per process.
  Without it there is no entry point — a wrong or missing prefix is a `404`,
  not a page.
- Every request must carry a `Host` naming loopback, which is what closes DNS
  rebinding: an attacker-controlled name that resolves to `127.0.0.1` still
  gets a `421`.

The URL is logged rather than opened, because opening it on every host start
would leave a signed-in tab behind. `consolePort` pins the port when a stable
one is wanted; the default `0` takes a free port.

The sign-in request returns as soon as the device attempt is under way and the
page polls `api/state` until the status settles — the grant takes as long as
the operator takes to approve it. `MinimaxAccount.signIn()` already collapses
concurrent callers onto one attempt, so a double click starts one.

### What the usage numbers are

`GET {quotaOrigin}/backend/account/token_plan/remains_percent`, carrying the
grant as a bare `token` header. Two findings worth recording:

- **No request signature.** The `yy` / `x-timestamp` / `x-signature` triple
  used elsewhere in MiniMax's stack belongs to the matrix gateway and the
  plugin-system cloud transport, not to these routes. A probe of seven header
  shapes against the live endpoint returned an identical answer for all of
  them (verified 2026-10-03).
- **Failures arrive in the body, not the status.** The service answers `200`
  and reports the outcome in `base_resp.status_code`. An omitted credential is
  `1004` (`not login`); a rejected one is `1016` (`invalid api key`). Both map
  to `QuotaAuthError` so the console offers sign-in again instead of showing a
  retry that cannot work.

The response meters exactly two windows — a short `interval` window and a
`weekly` one. **There is no monthly allowance field**, so the console has no
monthly line to draw; the toggle covers the two windows the service actually
reports, and a window the plan does not meter renders as absent rather than as
`0%`. The model ids and plan name come from the same payload where present.

Run the live probe with a deliberately invalid grant:

```sh
npm run quota-smoke   # expects QuotaAuthError: the endpoint was reached and evaluated
npm run quota-probe   # prints the base_resp for seven credential header shapes
```

Every field from the Messages protocol schema (`thinking`, `reasoningEffort`,
`maxTokens`, `defaultContextWindow`, `streamIdleTimeoutMs`, `retryPolicy`, …) is
available and behaves exactly as it does for the DeepSeek provider.

**`models` must be declared.** MiniMax serves no model-list route on this
endpoint — both `/models` and `/v1/models` answer
`503 direct_route_not_configured` — so the catalog cannot be enumerated. The
built-in default lists only the one wire id verified end-to-end; replace it with
the ids your plan actually serves. A wrong entry breaks the selector, not the
request.

## Credential behaviour

- **One interactive sign-in.** `signIn()` requests a device code, logs the
  verification URL and the 9-character user code, opens a browser, then polls
  the token endpoint. Concurrent callers join the same attempt.
- **Self-refreshing.** `resolveToken()` returns the stored access token until it
  is within 120s of expiry, then refreshes. A burst of parallel turns issues one
  refresh, not one per turn.
- **Origin-scoped.** The token is handed out only for the configured inference
  origin. Comparison is by parsed URL components, so
  `https://agent.minimax.cn.evil.test`, a non-HTTPS scheme, an explicit port,
  and embedded credentials are all refused.
- **Self-healing.** A refresh rejected with a terminal 4xx retires the stored
  refresh token and returns to signed-out, instead of replaying a grant that can
  never succeed. A 5xx leaves it intact for a later retry.
- **Late rejections are ignored.** `rejectToken()` clears only if the rejected
  token is still the stored one, so a 401 from a superseded request never signs
  out a fresh session.

Credentials are written to `credentialsPath` with mode `0600` via a
same-directory temp file and `rename`, so a crash mid-write leaves the previous
record intact.

## Using the account service directly

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.inject(['llm'], (child) => {
    child.effect(() => {
      const account = child.get('minimaxAccount')
      if (!account) return
      account.signIn().then((state) => child.logger.info('%o', state), (error) => {
        child.logger.error('minimax sign-in failed: %o', error)
      })
    })
  })
}
```

`ctx.minimaxAccount` exposes `signIn()`, `signOut()`, `resolveToken(url)`,
`rejectToken(token)`, `getState()` and `currentState()`. State transitions
publish `minimax-account/authenticated` and `minimax-account/signed-out`.

**`currentState()` is the one that answers "who is signed in".** The service
caches its state in memory and only reads the persisted grant when a token is
actually needed, which happens on an inference turn — so `getState()` alone
reports a restarted Host as signed out even when the credential is sitting on
disk. That is not a theoretical gap: it is what made the settings page tell a
signed-in operator to sign in again until they happened to send a message.
`getState()` stays for the code that legitimately wants the cheap, possibly-stale
answer; `currentState()` reads storage, caches what it found, and never
refreshes — minting tokens is `resolveToken`'s job.

## Scope and risk

`mcode-public` is the client id MiniMax ships inside its own desktop agent. It
is not a published third-party OAuth provider, and no MiniMax documentation
authorizes this use. The `agent.default` scope and `agent-backend` audience
authorize the desktop agent backend, not general platform access. The endpoint
can tighten this at any time — most visibly by adding a signature check — and
such a change would surface as a 401 on `/v1/messages`.

If you only need model access in your own software, an API key from
`platform.minimaxi.com` is the supported path. Use this provider when the goal is
specifically to spend an existing Coding Plan subscription.

## Distribution

This package is a **bundle**: its manifest declares `dsh.bundle`, and
`cordis.patch.yml` is the configuration layer a profile picks up.

```json
"dsh": { "bundle": { "patch": ["./cordis.patch.yml"] } }
```

`dsh plugin --profile <name> <args...>` forwards to pnpm inside the profile
directory, so every pnpm subcommand works. All of these are valid installs:

```sh
# registry
dsh plugin --profile demo add @audsiui/dsh-minimax-coding-plan
# absolute path (relative paths are refused)
dsh plugin --profile demo add /abs/path/to/dsh-minimax-coding-plan
# tarball
dsh plugin --profile demo add ./audsiui-dsh-minimax-coding-plan-0.1.0.tgz
# git
dsh plugin --profile demo add github:audsiui/-audsiui-dsh-minimax-coding-plan
```

A package with no `dsh.bundle` still installs, but only as a plain dependency:
`dsh plugin` warns and activates no layer.

### Never declare a `workspace:` peer range

Current `dsh` reads the manifest and **rejects an incompatible DSH peer before
pnpm runs** — nothing is downloaded and no build script executes. The same read
resolves registry specs through the same pnpm configuration the install uses.

That makes the `workspace:` protocol unusable here: a profile is not a pnpm
workspace, so `workspace:*` cannot resolve outside the harness monorepo. Declare
concrete semver ranges. This package uses:

```json
"peerDependencies": {
  "@deepseek-ai/cordis": ">=4.0.0 <5.0.0",
  "@deepseek-ai/cordis-plugin-loader": ">=1.0.0 <2.0.0",
  "@deepseek-ai/dsh-llm": ">=0.2.0-rc.2 <0.3.0",
  "@deepseek-ai/dsh-llm-deepseek": ">=0.2.0-rc.2 <0.3.0",
  "@deepseek-ai/schemastery": "~3.18.4"
}
```

A rejection prints `incompatible-version` with the offending `name`, `version`,
`runtimeVersion`, and unmet `peers`. Once a newer harness ships, the escape
hatch is an explicit authorization:

```sh
dsh plugin --profile demo allow-version @audsiui/dsh-minimax-coding-plan@0.1.0 \
  --dsh-version 0.2.1 --accept-risk
dsh plugin --profile demo revoke-version @audsiui/dsh-minimax-coding-plan@0.1.0 \
  --dsh-version 0.2.1
```

Authorizations live in the profile's `compatibility.json`, map one exact
`package@version` to exact runtime versions, and are inherited by neither a
plugin upgrade nor a harness upgrade. Only grant one after telling the operator
that the pairing may crash or lose data.

### Every `@deepseek-ai/*` dependency stays external

The running harness owns one instance of each. `tsdown.config.ts` marks the
whole scope external, and the build would silently grow by 34 kB without it.
That matters most for `@deepseek-ai/schemastery`: this package composes schema
objects it receives from `dsh-llm-deepseek`, and schemastery compares schemas by
instance, so a second copy produces schemas the host's loader cannot recognise.

**Git installs run no build and need no authorization.** `lib/` is committed to
this repository and the manifest declares **no `prepare`**, so pnpm has nothing to
prepare: it links the committed entry point and stops. There is no `allowBuilds`
entry, no SHA to rewrite on every commit, and no code from this package executing
on the operator's machine at install time.

The `prepare` script is the whole cause of the cost, and it is worth being precise
about the mechanism, because two plausible-sounding claims about it are wrong:

- pnpm decides a git-hosted package must be prepared **the moment a `prepare`
  script exists**. It never inspects whether build output is already present, so
  committing `lib/` does not exempt the package — the script is what decides.
- pnpm 10.26 turned that into a hard stop. A git-hosted package that declares
  `prepare` fails with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` until the operator
  adds a SHA-pinned `allowBuilds` key. Granting it does not make the install
  cheap: pnpm clones the repository, runs a package-manager install inside it to
  fetch every devDependency, and then runs the build.

Measured on this package with the harness's own pnpm, the `prepare` path took
**1m32s and installed 95 packages** to produce a handful of JavaScript files. The
same package without `prepare` installs in seconds and adds one package.

Which lifecycle hooks trigger that path is not obvious, so it was measured rather
than assumed. A matrix over the six hooks, each installed as a git dependency:

| Hook present | Git install |
| --- | --- |
| `prepare` | needs approval, builds |
| `prepack` | installs, no build |
| `prepublishOnly` | installs, no build |
| `prepublish` | installs, no build |
| no scripts | installs, no build |

`prepare` is the only one that triggers it. The absolute-path and tarball forms
were checked the same way and install without running anything either.

`prepack` stays in the manifest anyway, because it is the one hook pnpm never
runs for an installed package while `npm pack` and `npm publish` always do — so a
shipped tarball carries a freshly built `lib/` and an install never pays for one.

If you hit `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`, you are installing a commit
from before this change. The key pnpm wants is `name@<full tarball url>`, **not**
the bare package name, and it must be quoted because it contains `@` and `:`:

```yaml
allowBuilds:
  '@audsiui/dsh-minimax-coding-plan@https://codeload.github.com/audsiui/-audsiui-dsh-minimax-coding-plan/tar.gz/<sha>': true
```

That key embeds the commit hash, so it has to be rewritten on every update, and
it authorizes **the package's code to run on your machine at install time,
outside any agent sandbox**. Updating the package removes the need for it.

## Layering

A patch replaces the targeted row's **whole** `config` rather than deep-merging
keys, so a user overriding one key restates the ones they keep. This patch
carries only machine-safe defaults; `credentialsPath` is deliberately absent so
it resolves under `$DSH_HOME` per installation.

## Verification

All gates run standalone, against the **published** `@deepseek-ai/*` packages
rather than a monorepo checkout — which is the only arrangement that proves a
third-party install will work.

| Gate | Command | Covers |
| --- | --- | --- |
| types | `npm run typecheck` | the harness repository's strictness, against published `.d.ts` |
| build | `npm run build` | the self-contained publish build, all host deps external |
| artifacts | `npm run verify:artifacts` | the committed `src/generated/` and `lib/` are byte-identical to a fresh run |
| live | `npm run smoke` | OAuth + credential store against the **live** account origin |
| wiring | `node wiring.mjs` | `apply()` inside a real Cordis context with the real LLM runtime |
| quota shape | `node quota-smoke.mjs` | the usage read against the **live** endpoint with an invalid grant |
| header probe | `node quota-probe.mjs` | which credential header the service actually reads |

**When you change `src/`, run `npm run generate:typert && npm run build` and
commit both committed trees in the same commit.** They are tracked on purpose
(see the git-install note above), and neither is produced by the other, so a
change that rebuilds one and not the other leaves the plugin shipping yesterday's
JavaScript or a Remote codec that describes methods the code no longer has.
`npm run verify:artifacts` is what catches that: it regenerates, rebuilds,
compares both trees against the committed ones, lists every file that drifted,
and puts the working copy back exactly as it found it. Wire it into CI and the
failure moves from "a user noticed" to "the push failed".

### The gates' seam

`.` is the published interface, and it is deliberately small: the Cordis entry,
the config schema, the account service, the Remote service, and the wire
vocabulary they are described in. Not there, because a consumer never needs to
know them: the credential encoders, the authenticated read, the two readers and
the OAuth protocol client.

Those are reachable through `./testing`, which exists because the gates are most
valuable when they exercise the *built artifact* — and they do reach past the
plugin's own entry point to test the readers and the credential encoding
directly and hermetically. Publishing them under `.` to make that possible made
the interface a list of implementation details, and contradicted this package's
own source, which describes several of those modules as explicitly internal.
`./testing` is not an API and is not stable across releases.

**Reinstalling a git dependency requires restarting the host, not just the
plugin.** Node caches an ES module per process, so re-running `dsh plugin add`
— or any in-app reload — re-`import()`s the same URL and gets the namespace it
loaded before, default export and all. A fix that is correct on disk can
therefore keep failing in a host that never restarted. Quit the whole
application (including any tray or background process), reinstall, then start
it again. Note that the error's line number does not help you tell the two
builds apart: a change at the end of `src/index.ts` leaves every earlier line
number untouched.

`smoke.ts` runs the pure modules against the real endpoint: a device-authorization
request, one poll of an unapproved grant (exactly one HTTP request — it must not
fabricate a token or spin), a rejected refresh, the undeployed revoke route, and
credential-store round-trip plus validation.

`wiring.mjs` loads the built artifact into a real `Context` with the real
`LlmRuntime` and asserts the provider route registers, the account service is
provided, the origin guard refuses six lookalikes before *and* after sign-in,
the guard is origin-scoped rather than path-scoped, a stale 401 does not sign out
a live session, and a current 401 does. Neither script performs inference, so
neither spends quota.

**Not verified:** a real inference turn through a running `dsh` session, which
needs a live Coding Plan account.

**Not verified:** a real inference turn through a running `dsh` session. That
needs a full Web UI run against a live Coding Plan account.
