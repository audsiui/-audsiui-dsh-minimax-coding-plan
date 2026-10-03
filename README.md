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

| Region | Account origin | Messages origin |
| --- | --- | --- |
| `cn` | `https://account.minimax.cn` | `https://agent.minimax.cn/mavis/api/v1/llm` |
| `en` | `https://account.minimax.io` | `https://agent.minimax.io/mavis/api/v1/llm` |

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
    models:                      # required: there is no discovery route
      - id: MiniMax-M3.1-Flash-Preview
        name: MiniMax M3.1 Flash (Preview)
```

Inspect the merged result without starting a session:

```sh
dsh --profile demo --dump-config   # shows a "# == @audsiui/dsh-minimax-coding-plan" layer
```

Then select the route in the model picker as `minimax-coding-plan/<model-id>`.
The route stays hidden from discovery until a credential is stored, so an
unsigned harness does not advertise models it cannot call.

The first request before sign-in fails with `ACCOUNT_SIGN_IN_REQUIRED`. Drive
`ctx.minimaxAccount.signIn()` once (see below), or call it from a tiny plugin
placed after this one.

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
`rejectToken(token)`, and `getState()`. State transitions publish
`minimax-account/authenticated` and `minimax-account/signed-out`.

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

**Git installs pull source, not build output.** Nobody runs your `build`
script, so the `prepare` script here (`tsdown`, driven by a self-contained
`tsdown.config.ts` that transpiles `src/` with no project references and no type
checking) has to produce the entry by itself. pnpm ≥10 refuses to run a git
dependency's `prepare` until it is allowed, so the first `add` fails and the
operator copies the printed package key into the profile's
`pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@audsiui/dsh-minimax-coding-plan': true
```

That authorization means **the package's code runs on the operator's machine at
install time, outside any agent sandbox.** Only grant it for source you trust,
and pin a commit (`github:audsiui/-audsiui-dsh-minimax-coding-plan#<sha>`). Publishing to
npm or shipping a `pnpm pack` tarball avoids the question entirely, because the
artifact already contains `lib/`.

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
| live | `npm run smoke` | OAuth + credential store against the **live** account origin |
| wiring | `node wiring.mjs` | `apply()` inside a real Cordis context with the real LLM runtime |

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
