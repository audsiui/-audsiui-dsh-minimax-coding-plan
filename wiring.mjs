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

// The shape the service actually sends, captured verbatim from a live
// `remains_percent` read against a real grant. Nothing here is invented: the
// earlier fixture put the windows at the top level, which is not where the
// service puts them, and it had a single model where the service answers with
// one entry per model family.
const REAL_SHAPE = {
  model_remains: [
    {
      model_name: "general",
      start_time: 1790992800000,
      end_time: 1791010800000,
      remains_time: 2973467,
      current_interval_total_count: -1,
      current_interval_used_count: -1,
      current_interval_remains_count: -1,
      current_interval_used_percent: "0%",
      current_interval_total_percent: "100%",
      current_interval_status: 1,
      weekly_start_time: 1790524800000,
      weekly_end_time: 1791129600000,
      weekly_remains_time: 121773467,
      current_weekly_total_count: -1,
      current_weekly_used_count: -1,
      current_weekly_remains_count: -1,
      current_weekly_used_percent: "6%",
      // A total above 100. Clamping it would have rendered a 150% allowance
      // as 100% — permanently two-thirds spent.
      current_weekly_total_percent: "150%",
      current_weekly_status: 1,
    },
    {
      model_name: "video",
      start_time: 1790956800000,
      end_time: 1791043200000,
      remains_time: 35373467,
      current_interval_total_count: 3,
      current_interval_used_count: 0,
      current_interval_remains_count: 3,
      current_interval_used_percent: "0%",
      current_interval_total_percent: "100%",
      current_interval_status: 1,
      weekly_start_time: 1790524800000,
      weekly_end_time: 1791129600000,
      weekly_remains_time: 121773467,
      // Real counts: this window is metered, unlike the `general` one above.
      current_weekly_total_count: 21,
      current_weekly_used_count: 0,
      current_weekly_remains_count: 21,
      current_weekly_used_percent: "0%",
      current_weekly_total_percent: "100%",
      current_weekly_status: 1,
    },
  ],
  base_resp: { status_code: 0, status_msg: "success" },
};

const parsed = await minimax.fetchQuota(quotaFor(REAL_SHAPE));
const generalWeekly = parsed.windows.find(w => w.model === "general" && w.window === "weekly");
const generalInterval = parsed.windows.find(w => w.model === "general" && w.window === "interval");
const videoWeekly = parsed.windows.find(w => w.model === "video" && w.window === "weekly");
check("the weekly window is parsed from the percent string", generalWeekly.usedPercent === 6, `${generalWeekly.usedPercent}`);
check("the interval window is parsed from the percent string", generalInterval.usedPercent === 0, `${generalInterval.usedPercent}`);
check("a total above 100 is not clamped", generalWeekly.totalPercent === 150, `${generalWeekly.totalPercent}`);
check("a trailing % is stripped", generalInterval.totalPercent === 100, `${generalInterval.totalPercent}`);
check("an epoch-ms reset passes through", generalWeekly.resetAtMs === 1791129600000, `${generalWeekly.resetAtMs}`);
check("the interval reset comes from end_time", generalInterval.resetAtMs === 1791010800000, `${generalInterval.resetAtMs}`);
check("the service's own remaining time is reported",
  generalWeekly.remainsMs === 121773467 && generalInterval.remainsMs === 2973467,
  `${generalWeekly.remainsMs} / ${generalInterval.remainsMs}`);
check("the service's window status is carried verbatim", generalWeekly.status === 1, `${generalWeekly.status}`);
check("counts of -1 read as an unmetered window", generalWeekly.metered === false, `${generalWeekly.metered}`);
check("real counts read as a metered window", videoWeekly.metered === true, `${videoWeekly.metered}`);
check("one entry per model family, two windows each", parsed.windows.length === 4, `${parsed.windows.length}`);
check("the models are kept apart", new Set(parsed.windows.map(w => w.model)).size === 2);
check("fetchedAt is the injected clock", parsed.fetchedAtMs === 1_700_000_000_000);

// A seconds-valued reset is still lifted, since the service is not consistent
// about the unit and the older fixture proved the seconds form exists.
const seconds = await minimax.fetchQuota(quotaFor({
  model_remains: [{ model_name: "general", weekly_end_time: 1_700_600_000 }],
  base_resp: { status_code: 0 },
}));
check("a seconds-valued reset is lifted to millis",
  seconds.windows.find(w => w.window === "weekly").resetAtMs === 1_700_600_000_000,
  `${seconds.windows.find(w => w.window === "weekly").resetAtMs}`);

// A body with no `model_remains` is a plan that meters nothing — not a shape
// change to guess at, and not a window that reads as 0% used.
const unmetered = await minimax.fetchQuota(quotaFor({ base_resp: { status_code: 0 } }));
check("a body with no model_remains reports no windows at all",
  unmetered.windows.length === 0, `${unmetered.windows.length}`);

// An unrecognised model must still produce windows rather than being dropped.
const unnamed = await minimax.fetchQuota(quotaFor({
  model_remains: [{ current_weekly_total_percent: "100%", current_weekly_used_percent: "5%" }],
  base_resp: { status_code: 0 },
}));
check("an entry with no model_name is still reported",
  unnamed.windows.length === 2 && unnamed.windows.every(w => w.model === "unknown"),
  unnamed.windows.map(w => w.model).join(","));

// 1016 is the only auth code that has been observed, and the live endpoint
// answers it for a missing credential and a rejected one alike — probed with no
// header, an empty header, and two garbage bearers. An earlier version also
// treated 1004 as the "no credential" code; there is no such distinction.
let staleError;
try { await minimax.fetchQuota(quotaFor({ base_resp: { status_code: 1016, status_msg: "invalid api key" } })); }
catch (e) { staleError = e; }
check("a rejected grant raises QuotaAuthError",
  staleError instanceof minimax.QuotaAuthError, `${staleError?.name} ${staleError?.statusCode ?? ""}`);
check("the message carries the service's own code and wording",
  staleError?.message.includes("1016") && staleError.message.includes("invalid api key"),
  staleError?.message);

let bizError;
try { await minimax.fetchQuota(quotaFor({ base_resp: { status_code: 1003, status_msg: "group-not-member" } }, 401)); }
catch (e) { bizError = e; }
check("a non-auth business code is not mistaken for an expired grant",
  !(bizError instanceof minimax.QuotaAuthError) && bizError instanceof minimax.QuotaNetworkError, bizError?.name);
check("an unrecognised code still reports what the server said",
  bizError?.message.includes("1003") && bizError.message.includes("group-not-member"), bizError?.message);

let nonJson;
try {
  await minimax.fetchQuota({ ...quotaFor(null), fetchImpl: async () => new Response("<html>login</html>", { status: 200 }) });
} catch (e) { nonJson = e; }
check("an HTML body is a network error, not a silent empty quota",
  nonJson instanceof minimax.QuotaNetworkError, nonJson?.message);

// The grant travels as `Authorization: Bearer`. This was wrong once: an earlier
// version sent a bare `token` header, on the strength of a note claiming the
// service checks that one instead. Verified against the live endpoint with a
// real grant — the bare header answers `1016 invalid api key`, the identical
// token answers `status_code: 0` under the bearer header. Pinned here so the
// regression cannot come back quietly.
let seenAuthorization;
let seenBareToken;
await minimax.fetchQuota({
  ...quotaFor({ base_resp: { status_code: 0 } }),
  fetchImpl: async (_url, init) => {
    const headers = new Headers(init.headers);
    seenAuthorization = headers.get("authorization");
    seenBareToken = headers.get("token");
    return jsonResponse({ base_resp: { status_code: 0 } });
  },
});
check("the grant is sent as Authorization: Bearer", seenAuthorization === "Bearer quota-token", `${seenAuthorization}`);
check("the grant is not sent as a bare token header", seenBareToken === null, `${seenBareToken}`);

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
  fetchImpl: async () => jsonResponse({
    model_remains: [{
      model_name: "general",
      current_weekly_total_percent: "100%", current_weekly_used_percent: "12%",
      current_weekly_total_count: 10, current_weekly_used_count: 1, current_weekly_status: 1,
    }],
    base_resp: { status_code: 0 },
  }),
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
const remoteWeekly = grant.windows.find(w => w.model === "general" && w.window === "weekly");
check("quota reads through the Remote", remoteWeekly?.usedPercent === 12, JSON.stringify(grant.windows));
check("the Remote keeps the model identity on the wire", remoteWeekly?.model === "general", remoteWeekly?.model);
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

// --- A sign-in that never starts must be reportable as a failure -----------
//
// The Remote declared `minimax/sign-in-failed` but had no code path that could
// raise it: `beginSignIn` awaited a promise that only ever resolved, and the
// attempt that actually failed was one nobody awaited. So the operator pressed
// 登录, the code request died, and the surface reported a plain `signed-out` —
// indistinguishable from never having pressed anything. The declared code was
// decoration.
{
  const dir = await mkdtemp(join(tmpdir(), "minimax-failstart-"));
  const failing = new minimax.MinimaxAccount(new Context(), {
    endpoints: minimax.REGION_ENDPOINTS.cn,
    region: "cn",
    credentialsPath: join(dir, "credential.json"),
    openBrowser: false,
    client: {
      now: () => 0,
      sleep: async () => {},
      fetchImpl: async () => jsonResponse(
        { error: "invalid_client", error_description: "audience is not allowed for this client" }, 400,
      ),
    },
  });
  let beginFailure;
  try { await failing.beginSignIn(); } catch (error) { beginFailure = error; }
  check("beginSignIn rejects when the code request itself fails", beginFailure !== undefined,
    String(beginFailure));
  check("the rejection is the server's own error, not a wrapper", beginFailure?.code === "invalid_client",
    beginFailure?.code);
  // `error_description` used to be dropped on the floor, leaving an operator
  // and a maintainer staring at `device_authorization_failed` with no cause.
  check("the server's error_description survives",
    typeof beginFailure?.message === "string" && beginFailure.message.includes("audience is not allowed"),
    beginFailure?.message);
  check("a failed attempt leaves the account signed out", failing.getState().status === "signed-out",
    failing.getState().status);

  const remoteCtx = new Context();
  const service = new minimax.MinimaxRemoteService(remoteCtx, {
    account: failing,
    endpoints: minimax.REGION_ENDPOINTS.cn,
    region: "cn",
  });
  let thrown;
  try { await service.signIn(); } catch (error) { thrown = error; }
  // An exception escaping a @Remote method is folded by the Gateway into
  // `gateway/internal`, which the surface cannot tell from an internal fault.
  check("the Remote raises the code it declared",
    thrown?.code === "minimax/sign-in-failed", thrown?.code);
  check("the RemoteError carries the underlying reason",
    typeof thrown?.details?.reason === "string" && thrown.details.reason.includes("audience is not allowed"),
    String(thrown?.details?.reason));
}

// --- Walking away from a sign-in must not take the process down ------------
//
// The attempt's own promise is stored on the service and awaited by nobody when
// the caller only wants the transition. Without a handler its rejection is a
// process-level unhandledRejection — an operator who pressed 登录 and then
// declined the browser prompt could kill the Host.
{
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  const dir = await mkdtemp(join(tmpdir(), "minimax-unhandled-"));
  const abandoned = new minimax.MinimaxAccount(new Context(), {
    endpoints: minimax.REGION_ENDPOINTS.cn,
    region: "cn",
    credentialsPath: join(dir, "credential.json"),
    openBrowser: false,
    client: {
      now: () => 0,
      sleep: async () => {},
      fetchImpl: async () => jsonResponse({ error: "temporarily_unavailable" }, 503),
    },
  });
  try { await abandoned.beginSignIn(); } catch { /* expected */ }
  // Two macrotask turns: the first drains the microtask queue, the second is
  // where Node reports a rejection nobody handled.
  await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 10));
  process.off("unhandledRejection", onUnhandled);
  check("an abandoned sign-in raises no unhandledRejection", unhandled.length === 0,
    unhandled.map(reason => String(reason)).join("; "));
}

// --- The polling deadline belongs to the device code, not to the poller -----
//
// `expires_in` is the lifetime of the code (RFC 8628 §3.2), counted by the
// server from when it issued it. Anchored to the first poll instead, a caller
// that took a while to arrive polled a code that had already died.
{
  let issuedAt = 1_000;
  const polled = [];
  const expired = new minimax.MinimaxAccount(new Context(), {
    endpoints: minimax.REGION_ENDPOINTS.cn,
    region: "cn",
    credentialsPath: join(join(tmpdir(), "minimax-deadline-"), "credential.json"),
    openBrowser: false,
    client: {
      // The clock only moves when a sleep elapses, so the interval the server
      // asked for is the only thing that advances the deadline.
      now: () => issuedAt,
      sleep: async (ms) => { issuedAt += ms; },
      fetchImpl: async (url) => {
        if (String(url).endsWith("/oauth2/device/code")) {
          return jsonResponse({
            device_code: "dc", user_code: "U-1",
            verification_uri: "https://example.test/verify", expires_in: 10, interval: 5,
          });
        }
        polled.push(issuedAt);
        return jsonResponse({ error: "authorization_pending" }, 400);
      },
    },
  });
  await expired.beginSignIn();
  // Two 5s polls fit inside a 10s code; the third would land at 15s.
  await new Promise(resolve => setTimeout(resolve, 30));
  check("polling stops at the code's own expiry", polled.length <= 2, `${polled.length} poll(s)`);

  // The same clock, one that starts late: the code was issued 8s ago and lives
  // 10s, so only one more poll is legitimate.
  issuedAt = 1_000;
  const lateStart = 1_008;
  issuedAt = lateStart;
  const latePolled = [];
  const late = new minimax.MinimaxAccount(new Context(), {
    endpoints: minimax.REGION_ENDPOINTS.cn,
    region: "cn",
    credentialsPath: join(join(tmpdir(), "minimax-late-"), "credential.json"),
    openBrowser: false,
    client: {
      now: () => issuedAt,
      sleep: async (ms) => { issuedAt += ms; },
      fetchImpl: async (url) => {
        if (String(url).endsWith("/oauth2/device/code")) {
          // The stamp is taken at the moment the response lands, which is what
          // `requestDeviceAuthorization` records.
          issuedAt = lateStart;
          return jsonResponse({
            device_code: "dc", user_code: "U-1",
            verification_uri: "https://example.test/verify", expires_in: 10, interval: 5,
          });
        }
        latePolled.push(issuedAt);
        return jsonResponse({ error: "authorization_pending" }, 400);
      },
    },
  });
  await late.beginSignIn();
  await new Promise(resolve => setTimeout(resolve, 30));
  check("the deadline is anchored to the authorization response, not the first poll",
    latePolled.length === 1, `${latePolled.length} poll(s)`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
