/**
 * Wiring test: apply the built plugin into a real Cordis context with the real
 * LLM runtime, then assert the provider route, the account service, the
 * origin guard, and the late-rejection rule.
 *
 * Requires the host runtime to be built first (`pnpm run build:lib:host` in
 * the repository). Touches no network: the credential is written to a temp
 * directory, so no quota is spent.
 */
﻿import { mkdtemp } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import AuthorizationService from "@deepseek-ai/dsh-authorization";
import LocalCredentialProvider from "@deepseek-ai/dsh-credentials-local";
import * as minimax from "./lib/index.js";

const dir = await mkdtemp(join(tmpdir(), "minimax-apply-"));
const credentialsPath = join(dir, "credential.json");
const config = minimax.Config({ credentialsPath, openBrowser: false });

const ctx = new Context();
await ctx.plugin(LlmRuntime);
await ctx.plugin(LocalCredentialProvider, { path: join(dir, "credentials.yaml") });
await ctx.plugin(AuthorizationService);
minimax.apply(ctx, config);
const account = ctx.get("minimaxAccount");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};

// Reproduce exactly what `cordis-plugin-loader` does to a module before it
// reaches `ctx.plugin()`, then assert the shape that survives. A default export
// collapses the module namespace to the bare `apply` function and silently drops
// `inject`, which is invisible to a test that calls `apply()` directly: the
// provider registers fine and only fails at harness boot with
// `cannot get property "llm" without inject`.
const unwrapExports = (exports) => {
  if (exports === null || exports === undefined) return exports;
  exports = exports.default ?? exports;
  if (!exports.__esModule) return exports;
  return exports.default ?? exports;
};
const asLoaded = unwrapExports(minimax);
check("no default export (loader would drop inject)",
  minimax.default === undefined, `default=${typeof minimax.default}`);
check("inject survives loader unwrapping",
  Array.isArray(asLoaded.inject) && asLoaded.inject.includes("llm"),
  `inject=${JSON.stringify(asLoaded.inject)}`);
check("apply survives loader unwrapping", typeof asLoaded.apply === "function");
check("Config survives loader unwrapping", typeof asLoaded.Config === "function");
check("name survives loader unwrapping", asLoaded.name === "llm-minimax-coding-plan");

// The authorization seam is the supported way to obtain this grant: it owns
// cancellation, one-attempt-per-key and commit confirmation. A flow that never
// appears in ctx.authorization.list() is invisible to every surface and to the
// agent-facing API, and the plugin silently has no way to sign in.
// ctx.inject() runs its callback once the service is available, which is not
// necessarily before apply() returns, so let the registration settle first.
await new Promise(resolve => setTimeout(resolve, 0));
const flows = ctx.authorization.list();
const flow = flows.find(entry => entry.key === minimax.GRANT_KEY);
check("authorization flow registered", flow !== undefined,
  `keys=${JSON.stringify(flows.map(e => e.key))}`);check("flow key is the plugin's own scope",
  minimax.GRANT_KEY === "llm-minimax-coding-plan/default", minimax.GRANT_KEY);
check("flow labelled for a human surface", flow?.label === "MiniMax Coding Plan", flow?.label);
check("flow offers a typed method",
  Array.isArray(flow?.methods) && flow.methods.length > 0 && typeof flow.methods[0].id === "string",
  JSON.stringify(flow?.methods));
check("flow starts idle", flow?.inFlight === false);
check("no second flow claims the key",
  flows.filter(entry => entry.key === minimax.GRANT_KEY).length === 1);

// The seam is the source of truth, so a grant committed there must be what the
// provider hands out — otherwise signing in through the flow would appear to
// succeed and the next request would still say ACCOUNT_SIGN_IN_REQUIRED.
const committed = {
  kind: "grant",
  payload: {
    schemaVersion: 1,
    clientId: "mcode-public",
    accessToken: "seam-token",
    refreshToken: "seam-refresh",
    expiresAtMs: Date.now() + 3_600_000,
    scopes: ["agent.default"],
    accountId: "acct-seam",
    subject: "sub-seam",
    region: "cn",
  },
};
await ctx.credentials.modifyRecord(minimax.GRANT_KEY, () => Promise.resolve(committed));
check("account reads the grant from the credential seam",
  await account.resolveToken("https://agent.minimax.cn/mavis/api/v1/llm") === "seam-token");
check("account is authenticated from the seam",
  account.getState().status === "authenticated", account.getState().status);
check("opaque payload is rejected when it is not ours",
  minimax.parseGrantPayload({ schemaVersion: 1, clientId: "someone-else" }) === undefined);
check("a payload missing the required scope is refused",
  minimax.parseGrantPayload({ ...committed.payload, scopes: ["other"] }) === undefined);
await account.signOut();
check("sign-out clears the seam record",
  (await ctx.credentials.readRecord(minimax.GRANT_KEY)) === undefined);
check("sign-out leaves the account signed out",
  account.getState().status === "signed-out");

check("provider route registered",
  ctx.llm.listProviders().map(p => p.id).includes("minimax-coding-plan"));
check("account service provided", account !== undefined);
check("starts signed out", account?.getState()?.status === "signed-out");

const OK = "https://agent.minimax.cn/mavis/api/v1/llm";
const lookalikes = [
  ["host prefix attack", "https://agent.minimax.cn.evil.test/mavis/api/v1/llm"],
  ["downgraded scheme",  "http://agent.minimax.cn/mavis/api/v1/llm"],
  ["non-default port",   "https://agent.minimax.cn:8443/mavis/api/v1/llm"],
  ["embedded creds",     "https://user:pw@agent.minimax.cn/mavis/api/v1/llm"],
  ["other region",       "https://agent.minimax.io/mavis/api/v1/llm"],
];

check("signed out yields no token", await account.resolveToken(OK) === undefined);
for (const [label, url] of lookalikes) {
  check(`refused before sign-in: ${label}`, await account.resolveToken(url) === undefined);
}

await minimax.writeCredential(credentialsPath, {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  expiresAtMs: Date.now() + 3_600_000,
  scopes: ["agent.default"],
  accountId: "acct-test",
  subject: "sub-test",
}, "cn");

check("valid origin receives the token", await account.resolveToken(OK) === "test-access-token");
// The guard is origin-scoped, not path-scoped: any path on the allowed
// origin reaches the same server, so restricting paths would add no
// protection. This matches the DeepSeek account service.
check("same origin, different path is allowed",
  await account.resolveToken("https://agent.minimax.cn/anything/else") === "test-access-token");
check("state becomes authenticated", account.getState()?.status === "authenticated");
for (const [label, url] of lookalikes) {
  check(`refused after sign-in: ${label}`, await account.resolveToken(url) === undefined);
}

// A late 401 for a token that is no longer the stored one must not sign out.
await minimax.writeCredential(credentialsPath, {
  accessToken: "newer-token", refreshToken: "newer-refresh",
  expiresAtMs: Date.now() + 3_600_000, scopes: ["agent.default"],
  accountId: "acct-test", subject: "sub-test",
}, "cn");
await account.rejectToken("test-access-token");
check("stale rejection is ignored",
  account.getState()?.status === "authenticated" && await account.resolveToken(OK) === "newer-token");

await account.rejectToken("newer-token");
check("current rejection signs out",
  account.getState()?.status === "signed-out" && await account.resolveToken(OK) === undefined);

// ---------------------------------------------------------------------------
// Plan quota reads.
//
// The service answers 1004 for a missing or stale grant, and every other
// failure arrives inside `base_resp` rather than as an HTTP status. These
// assertions pin both: a caller that only checked `response.ok` would render
// "no quota" for an expired grant and never ask the operator to sign in again.
// ---------------------------------------------------------------------------

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const quotaFor = (body, status = 200) => ({
  token: "quota-token",
  endpoints: minimax.REGION_ENDPOINTS.cn,
  fetchImpl: async () => jsonResponse(body, status),
  now: () => 1_700_000_000_000,
});

// The shape the service actually sends: percent values arrive as strings, and
// a window the plan does not meter is absent rather than zero.
const REAL_SHAPE = {
  base_resp: { status_code: 0, status_msg: "success" },
  current_interval_total_percent: "100",
  current_interval_used_percent: "37.5",
  current_interval_status: 1,
  end_time: 1_700_001_800,
  current_weekly_total_percent: "100%",
  current_weekly_used_percent: "12",
  current_weekly_status: 1,
  weekly_end_time: 1_700_600_000,
};

const parsed = await minimax.fetchQuota(quotaFor(REAL_SHAPE));
const weekly = parsed.windows.find(w => w.id === "weekly");
const interval = parsed.windows.find(w => w.id === "interval");
check("weekly window parsed from the percent string", weekly.usedPercent === 12, `${weekly.usedPercent}`);
check("interval window parsed from the percent string", interval.usedPercent === 38, `${interval.usedPercent}`);
check("a trailing % is stripped", weekly.totalPercent === 100, `${weekly.totalPercent}`);
check("a seconds-valued reset is lifted to millis", weekly.resetAtMs === 1_700_600_000_000, `${weekly.resetAtMs}`);
check("a metered window is not unlimited", weekly.unlimited === false && interval.unlimited === false);
check("fetchedAt is the injected clock", parsed.fetchedAtMs === 1_700_000_000_000);

// A status of 3 is the server's "not actually capped" marker.
const unlimited = await minimax.fetchQuota(quotaFor({
  base_resp: { status_code: 0 },
  current_weekly_total_percent: "100", current_weekly_status: 3,
}));
check("status 3 reads as unlimited", unlimited.windows.find(w => w.id === "weekly").unlimited === true);

const unmetered = await minimax.fetchQuota(quotaFor({ base_resp: { status_code: 0 } }));
check("an absent window is reported absent, not as 0% used",
  unmetered.windows.every(w => w.present === false && w.usedPercent === 0));

// A used share that overshoots its own total must clamp, so the bar cannot
// render wider than 100%.
const overshoot = await minimax.fetchQuota(quotaFor({
  base_resp: { status_code: 0 },
  current_weekly_total_percent: "100", current_weekly_used_percent: "140",
}));
check("used share clamps to the window total",
  overshoot.windows.find(w => w.id === "weekly").usedPercent === 100);

let authError;
try { await minimax.fetchQuota(quotaFor({ base_resp: { status_code: 1004, status_msg: "not login" } }, 401)); }
catch (e) { authError = e; }
check("a rejected grant raises QuotaAuthError", authError instanceof minimax.QuotaAuthError,
  `${authError?.name} ${authError?.statusCode ?? ""}`);

// 1016 is what the live service answers for a credential that is present but
// invalid; treating it as a transient failure would strand the operator on a
// console that never offers sign-in again.
let staleError;
try { await minimax.fetchQuota(quotaFor({ base_resp: { status_code: 1016, status_msg: "invalid api key" } })); }
catch (e) { staleError = e; }
check("a present-but-invalid grant also raises QuotaAuthError",
  staleError instanceof minimax.QuotaAuthError, `${staleError?.name} ${staleError?.statusCode ?? ""}`);

let bizError;
try { await minimax.fetchQuota(quotaFor({ base_resp: { status_code: 1003, status_msg: "group-not-member" } }, 401)); }
catch (e) { bizError = e; }
check("a non-auth business code is not mistaken for an expired grant",
  !(bizError instanceof minimax.QuotaAuthError) && bizError instanceof minimax.QuotaNetworkError, bizError?.name);

let nonJson;
try {
  await minimax.fetchQuota({ ...quotaFor(null), fetchImpl: async () => new Response("<html>login</html>", { status: 200 }) });
} catch (e) { nonJson = e; }
check("an HTML body is a network error, not a silent empty quota",
  nonJson instanceof minimax.QuotaNetworkError, nonJson?.message);

// The token must travel as the bare `token` header: a bearer header alone is
// answered with 1004 even when the grant is valid.
let seenHeader;
await minimax.fetchQuota({
  ...quotaFor({ base_resp: { status_code: 0 } }),
  fetchImpl: async (_url, init) => { seenHeader = new Headers(init.headers).get("token"); return jsonResponse({ base_resp: { status_code: 0 } }); },
});
check("the grant is sent as a bare `token` header", seenHeader === "quota-token", `${seenHeader}`);

// The Remote service: the browser half's only route to this process.
//
// What matters is that it projects rather than exposes. A surface must be able
// to render state and drive the two buttons with no path by which a token
// reaches the browser.
let remoteState = { status: "signed-out" };
let remoteToken;
let remoteSignOuts = 0;
let remoteSignIns = 0;
// A duck-typed account keeps this hermetic: the real one would open a
// device-code grant against the live account origin.
//
// `beginSignIn` is what the Remote calls. It resolves once the code request has
// come back — not at kickoff, and not after approval — which is the property
// the surface's poll depends on: returning the pre-attempt `signed-out` leaves
// the surface with nothing to re-read when the grant lands.
let remoteTokenPolls = 0;
const remoteAccount = {
  getState: () => remoteState,
  signIn: () => {
    remoteSignIns++;
    remoteState = { status: "authorizing", userCode: "ABCD-1234", verificationUri: "https://example.test/verify", verificationUriComplete: "https://example.test/verify?code=ABCD-1234", expiresInSec: 300 };
    return Promise.resolve(remoteState);
  },
  beginSignIn: async () => {
    remoteSignIns++;
    // The code request is a network round trip, so the state is still the
    // pre-attempt one on this tick — exactly the skew that lost the race.
    await new Promise(resolve => setTimeout(resolve, 0));
    remoteState = { status: "authorizing", userCode: "ABCD-1234", verificationUri: "https://example.test/verify", verificationUriComplete: "https://example.test/verify?code=ABCD-1234", expiresInSec: 300 };
    return remoteState;
  },
  signOut: () => { remoteSignOuts++; remoteState = { status: "signed-out" }; return Promise.resolve(remoteState); },
  resolveToken: (url) => (url === minimax.REGION_ENDPOINTS.cn.quotaOrigin && remoteToken !== undefined
    ? Promise.resolve(remoteToken)
    : Promise.resolve(undefined)),
  tokenPolls: () => remoteTokenPolls,
};

const remoteCtx = new Context();
const remoteService = new minimax.MinimaxRemoteService(remoteCtx, {
  account: remoteAccount,
  endpoints: minimax.REGION_ENDPOINTS.cn,
  region: "cn",
  fetchImpl: async () => jsonResponse({ base_resp: { status_code: 0 }, current_weekly_total_percent: "100", current_weekly_used_percent: "12" }),
});
check("Remote service binds its namespace", remoteService.typertRemote?.namespace === "minimax",
  remoteService.typertRemote?.namespace);
check("every @Remote method is reachable on the instance",
  ["state", "signIn", "signOut", "quota"].every(m => typeof remoteService[m] === "function"));

const wireOut = remoteService.state();
check("signed-out state is the wire projection", wireOut.status === "signed-out" && wireOut.accountId === null);
check("the wire projection never carries a token", !JSON.stringify(wireOut).includes("accessToken"));

// signIn resolves on the transition into `authorizing` — not at kickoff, and not
// after approval. The device grant takes as long as the operator takes, so
// holding the call open for the whole approval conversation would be wrong; but
// returning the pre-attempt `signed-out` is wrong too, because the surface's
// poll is gated on observing `authorizing`.
const authorizing = await remoteService.signIn();
check("signIn resolves on the authorizing transition, not on kickoff", authorizing.status === "authorizing", authorizing.status);
check("the projection carries the code and the complete page",
  authorizing.userCode === "ABCD-1234" && String(authorizing.verificationUri).includes("ABCD-1234"));
check("signIn does not wait for the approval", remoteAccount.tokenPolls() === 0, String(remoteAccount.tokenPolls()));
await new Promise(resolve => setTimeout(resolve, 0));
check("signIn started exactly one attempt", remoteSignIns === 1, String(remoteSignIns));

remoteState = { status: "authenticated", accountId: "acct-remote", expiresAtMs: 1700003600000 };
remoteToken = "remote-grant";
const authed = remoteService.state();
check("authenticated state carries the account id", authed.accountId === "acct-remote", authed.accountId);
check("authenticated state drops the device code", authed.userCode === null);

const grant = await remoteService.quota();
check("quota reads through the Remote", grant.windows.find(w => w.id === "weekly")?.usedPercent === 12,
  JSON.stringify(grant.windows.map(w => [w.id, w.usedPercent])));
check("quota never returns the grant", !JSON.stringify(grant).includes("remote-grant"));
check("a successful quota read is not flagged auth-expired", grant.authExpired === false && grant.error === null);

// A rejected grant travels as a flag rather than a thrown RemoteError: the
// surface has to be able to offer sign-in, not report a generic failure.
remoteToken = undefined;
const unresolvable = await remoteService.quota();
check("an unresolvable grant is reported as auth-expired", unresolvable.authExpired === true, unresolvable.error);

remoteState = { status: "signed-out" };
const signedOut = await remoteService.signOut();
check("signOut clears and reports signed-out", signedOut.status === "signed-out" && remoteSignOuts === 1);
const whileOut = await remoteService.quota();
check("quota short-circuits while signed out",
  whileOut.windows.length === 0 && whileOut.authExpired === false);
await remoteCtx.stop?.();

// --- The sign-in transition, against the real account service ------------------
//
// The bug this pins down: `signIn` used to return at kickoff, so the state a
// surface read immediately afterwards was the pre-attempt `signed-out`. A
// surface whose poll is gated on observing `authorizing` then never polls, and
// the grant the operator approves lands with nothing watching for it — the page
// reads "signed out" forever, with a browser window that closed successfully.
const deviceDir = await mkdtemp(join(tmpdir(), "minimax-device-"));
let tokenCalls = 0;
let approved = false;
const deviceAccount = new minimax.MinimaxAccount(new Context(), {
  endpoints: minimax.REGION_ENDPOINTS.cn,
  region: "cn",
  credentialsPath: join(deviceDir, "grant.json"),
  openBrowser: false,
  client: {
    // Defer rather than resolve instantly, so the poll loop cannot run ahead of
    // the assertion below and make a timing property look like it was violated.
    sleep: () => new Promise(resolve => setTimeout(resolve, 0)),
    now: () => Date.now(),
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/oauth2/device/code") {
        return jsonResponse({
          device_code: "dev-code", user_code: "ABCD-1234",
          verification_uri: "https://example.test/verify",
          verification_uri_complete: "https://example.test/verify?code=ABCD-1234",
          expires_in: 300, interval: 1,
        });
      }
      if (path === "/oauth2/token") {
        tokenCalls++;
        if (!approved) {
          return jsonResponse({ error: "authorization_pending" }, 400);
        }
        // A minimal but conformant RFC 6749 §5.1 token response: no `refresh_token`
        // (RFC 8628 §3.5 makes it optional) and no echoed `scope` (which the spec
        // defines as identical to the requested scope). Both used to be rejected,
        // throwing away a perfectly usable grant.
        return jsonResponse({
          access_token: "at-1", token_type: "Bearer", expires_in: 3600,
        });
      }
      throw new Error(`unexpected request to ${url}`);
    },
  },
});

const reached = await deviceAccount.beginSignIn();
check("beginSignIn resolves on the authorizing transition", reached.status === "authorizing", reached.status);
check("beginSignIn carries the code the operator has to type", reached.userCode === "ABCD-1234", reached.userCode);
// The property that matters is not "how many polls have happened" but "what the
// caller was handed": an attempt that is genuinely under way, while approval is
// still outstanding. Resolving on `signed-out` instead is what left the surface
// with nothing to re-read.
check("beginSignIn returns with approval still outstanding",
  reached.status === "authorizing" && deviceAccount.getState().status === "authorizing",
  deviceAccount.getState().status);

// Now the operator approves, and the loop is already in place to notice.
approved = true;
await new Promise(resolve => setTimeout(resolve, 20));
const settled = deviceAccount.getState();
check("the loop picks the grant up after approval", settled.status === "authenticated", settled.status);
check("a token without a refresh token or echoed scope is still accepted", tokenCalls > 0, `${tokenCalls} poll(s)`);
check("the stored record keeps the grant", (await deviceAccount.resolveToken(minimax.REGION_ENDPOINTS.cn.quotaOrigin)) === "at-1");

// The payload has to be storable, not merely correct. The credential store
// validates a payload as representable in JSON and refuses the whole file
// otherwise, which is fatal at Host start — before any of this code can run, so
// a plugin that wrote one such record could not even recover. A property set to
// `undefined` is the specific offender: `JSON.stringify` drops it, the validator
// does not forgive it.
const undefinedFree = (value) => Object.entries(value).every(([, member]) => member !== undefined);
const bareGrant = {
  accessToken: "at-2", refreshToken: undefined, expiresAtMs: 1,
  scopes: ["agent.default"], accountId: undefined, subject: undefined,
};
const payload = minimax.grantPayload(bareGrant, "cn");
check("the credential payload holds no undefined value", undefinedFree(payload),
  Object.entries(payload).filter(([, m]) => m === undefined).map(([k]) => k).join(", "));
check("an absent field is omitted, not written as undefined",
  !("accountId" in payload) && !("subject" in payload) && !("refreshToken" in payload));
check("the payload survives a JSON round trip unchanged",
  JSON.stringify(JSON.parse(JSON.stringify(payload))) === JSON.stringify(payload));
check("the payload reads back as a usable grant",
  minimax.parseGrantPayload(JSON.parse(JSON.stringify(payload)))?.accessToken === "at-2");
const fullGrant = { ...bareGrant, refreshToken: "rt", accountId: "acct-1", subject: "sub-1" };
const fullPayload = minimax.grantPayload(fullGrant, "cn");
check("a fully populated grant keeps every field",
  fullPayload.refreshToken === "rt" && fullPayload.accountId === "acct-1" && fullPayload.subject === "sub-1");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
