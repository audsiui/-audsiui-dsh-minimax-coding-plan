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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
