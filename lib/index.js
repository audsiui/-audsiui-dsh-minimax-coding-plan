import { ACCOUNT_QUOTA_EXCEEDED_CODE, LlmError, QUOTA_EXCEEDED_CODE } from "@deepseek-ai/dsh-llm";
import { catalogModelInfo, deepSeekConfigFields, plainOptions, registerDeepSeekProvider, resolveAdapterOptions } from "@deepseek-ai/dsh-llm-deepseek";
import { spawn } from "node:child_process";
import { Service } from "@deepseek-ai/cordis";
import { createHash, randomBytes } from "node:crypto";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import z from "@deepseek-ai/schemastery";
import { createServer } from "node:http";
//#region src/constants.ts
/** Wire constants for the MiniMax account origin and its Messages endpoint. */
/**
* Public client identifier MiniMax ships in its own desktop agent. The grant
* is a public client: there is no client secret and PKCE is the only binding.
*/
const OAUTH_CLIENT_ID = "mcode-public";
/** The single scope this grant authorizes. A token without it is unusable. */
const OAUTH_SCOPE = "agent.default";
/** Token audience selecting the agent backend rather than the open platform. */
const OAUTH_AUDIENCE = "agent-backend";
/** IETF device-authorization grant type used by the token endpoint. */
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
/** Regions MiniMax serves, selected by configuration. */
const REGION_ENDPOINTS = {
	cn: {
		accountOrigin: "https://account.minimax.cn",
		inferenceOrigin: "https://agent.minimax.cn/mavis/api/v1/llm",
		quotaOrigin: "https://www.minimaxi.com"
	},
	en: {
		accountOrigin: "https://account.minimax.io",
		inferenceOrigin: "https://agent.minimax.io/mavis/api/v1/llm",
		quotaOrigin: "https://platform.minimax.io"
	}
};
/**
* Advisory catalog used when none is configured.
*
* MiniMax exposes no model-discovery route on this endpoint (`/models` and
* `/v1/models` both answer `direct_route_not_configured`), so the catalog
* cannot be enumerated and must be declared. This default carries only the
* wire id verified end-to-end against the device-grant token; replace it with
* the ids your Coding Plan actually serves.
*/
const DEFAULT_MODELS = [{
	id: "MiniMax-M3.1-Flash-Preview",
	name: "MiniMax M3.1 Flash (Preview)",
	description: "Coding Plan model served by the MiniMax agent backend."
}];
/**
* Refresh this many milliseconds before the access token actually expires, so
* a request never leaves the host mid-flight with a token about to lapse.
*/
const TOKEN_REFRESH_MARGIN_MS = 12e4;
//#endregion
//#region src/oauth.ts
/**
* MiniMax OAuth 2.0 device-authorization client (RFC 8628 + PKCE).
*
* Deliberately free of harness types: the wire contract is testable on its
* own, and the provider layer stays a thin adapter over it.
*/
/** A protocol-level rejection carrying the server's own error code. */
var OAuthProtocolError = class extends Error {
	/** Server-supplied `error` value, or a client-side classification. */
	code;
	/** HTTP status, when the failure came from a response. */
	httpStatus;
	/** @param code - server error code. @param message - human-readable detail. @param httpStatus - response status. */
	constructor(code, message, httpStatus) {
		super(message ?? `MiniMax OAuth rejected the request (${code}${httpStatus ? `, HTTP ${httpStatus}` : ""}).`);
		this.name = "OAuthProtocolError";
		this.code = code;
		this.httpStatus = httpStatus;
	}
};
/** One form POST against the account origin, with OAuth error extraction. */
async function postForm(endpoints, path, values, options, signal, post) {
	const response = await (options.fetchImpl ?? fetch)(`${endpoints.accountOrigin}${path}`, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body: new URLSearchParams(values),
		...signal ? { signal } : {}
	});
	if (post?.tolerateMissing && (response.status === 404 || response.status === 405)) return {
		ok: true,
		status: response.status,
		body: {}
	};
	const body = asRecord(await response.json().catch(() => void 0));
	if (!body) throw new OAuthProtocolError("invalid_json_response", void 0, response.status);
	const error = readString(body, "error");
	return {
		ok: response.ok && !error,
		status: response.status,
		body,
		...error === void 0 ? {} : { error }
	};
}
/**
* Start a device authorization and return everything needed to finish it.
* @param endpoints - region origins.
* @param options - injectable collaborators.
* @param signal - cancels the request.
* @returns the pending authorization, including the PKCE verifier.
*/
async function requestDeviceAuthorization(endpoints, options = {}, signal) {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
	const result = await postForm(endpoints, "/oauth2/device/code", {
		client_id: OAUTH_CLIENT_ID,
		scope: OAUTH_SCOPE,
		audience: OAUTH_AUDIENCE,
		code_challenge: codeChallenge,
		code_challenge_method: "S256"
	}, options, signal);
	if (!result.ok) throw new OAuthProtocolError(result.error ?? "device_authorization_failed", void 0, result.status);
	const deviceCode = readString(result.body, "device_code");
	const userCode = readString(result.body, "user_code");
	const verificationUri = readString(result.body, "verification_uri") ?? readString(result.body, "verification_url");
	const expiresInSec = readPositiveNumber(result.body, "expires_in");
	if (!deviceCode || !userCode || !verificationUri || !expiresInSec) throw new OAuthProtocolError("invalid_device_authorization_response", void 0, result.status);
	return {
		deviceCode,
		userCode,
		verificationUri,
		verificationUriComplete: readString(result.body, "verification_uri_complete"),
		expiresInSec,
		intervalSec: readPositiveNumber(result.body, "interval") ?? 5,
		codeVerifier
	};
}
/**
* Poll until the operator approves, the grant is denied, or it expires.
*
* The server signals a not-yet-approved attempt either with HTTP 400 plus
* `authorization_pending` (RFC 8628) or with HTTP 200 plus a `status` field
* (`pending` / `slow_down` / `denied`); both shapes are accepted because this
* account service uses the second one.
*
* @param endpoints - region origins.
* @param authorization - pending authorization from {@link requestDeviceAuthorization}.
* @param options - injectable collaborators.
* @param signal - stops polling.
* @returns the granted token set.
*/
async function pollDeviceToken(endpoints, authorization, options = {}, signal) {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const deadline = now() + authorization.expiresInSec * 1e3;
	let intervalMs = authorization.intervalSec * 1e3;
	while (now() < deadline) {
		signal?.throwIfAborted();
		const result = await postForm(endpoints, "/oauth2/token", {
			grant_type: DEVICE_GRANT_TYPE,
			device_code: authorization.deviceCode,
			client_id: OAUTH_CLIENT_ID,
			code_verifier: authorization.codeVerifier
		}, options, signal);
		const status = readString(result.body, "status");
		if (result.ok) {
			if (status === "pending") {
				await sleep(intervalMs);
				continue;
			}
			if (status === "slow_down") {
				intervalMs += 5e3;
				await sleep(intervalMs);
				continue;
			}
			if (status === "denied" || status === "access_denied") throw new OAuthProtocolError("access_denied");
			if (status === "expired" || status === "expired_token") throw new OAuthProtocolError("expired_token");
			return parseTokenGrant(result.body, now());
		}
		if (result.error === "authorization_pending" || result.error === "slow_down") {
			if (result.error === "slow_down") intervalMs += 5e3;
			await sleep(intervalMs);
			continue;
		}
		throw new OAuthProtocolError(result.error ?? "device_authorization_failed", void 0, result.status);
	}
	throw new OAuthProtocolError("expired_token", "The MiniMax device authorization expired before it was approved.");
}
/**
* Exchange a refresh token for a new access token.
* @param endpoints - region origins.
* @param refreshToken - stored refresh token.
* @param options - injectable collaborators.
* @param signal - cancels the request.
* @returns the granted token set; the server may or may not rotate the refresh token.
*/
async function refreshAccessToken(endpoints, refreshToken, options = {}, signal) {
	const result = await postForm(endpoints, "/oauth2/token", {
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: OAUTH_CLIENT_ID,
		scope: OAUTH_SCOPE,
		audience: OAUTH_AUDIENCE
	}, options, signal);
	if (!result.ok) throw new OAuthProtocolError(result.error ?? "token_refresh_failed", void 0, result.status);
	return parseTokenGrant(result.body, (options.now ?? Date.now)(), refreshToken);
}
/**
* Revoke a refresh token, best-effort.
*
* The production account origin answers `404` here — the revocation route is
* referenced by MiniMax's own client but is not deployed — so a missing
* endpoint is treated as "already unusable" and sign-out still completes. Any
* other failure propagates for the caller to log.
*
* @param endpoints - region origins.
* @param refreshToken - stored refresh token.
* @param options - injectable collaborators.
* @param signal - cancels the request.
*/
async function revokeRefreshToken(endpoints, refreshToken, options = {}, signal) {
	const result = await postForm(endpoints, "/oauth2/revoke", {
		token: refreshToken,
		token_type_hint: "refresh_token",
		client_id: OAUTH_CLIENT_ID
	}, options, signal, { tolerateMissing: true });
	if (!result.ok) throw new OAuthProtocolError(result.error ?? "oauth_request_failed", void 0, result.status);
}
/** Validate one token response and project it onto {@link TokenGrant}. */
function parseTokenGrant(body, nowMs, previousRefreshToken) {
	const accessToken = readString(body, "access_token");
	const refreshToken = readString(body, "refresh_token") ?? previousRefreshToken;
	const tokenType = readString(body, "token_type");
	const expiresInSec = readPositiveNumber(body, "expires_in");
	const claims = accessToken ? decodeJwtPayload(accessToken) : void 0;
	const scopes = parseScopes(body.scope ?? claims?.scope ?? claims?.scp);
	if (!accessToken || !refreshToken || tokenType?.toLowerCase() !== "bearer" || !expiresInSec || !scopes.includes("agent.default")) throw new OAuthProtocolError("invalid_token_response");
	return {
		accessToken,
		refreshToken,
		expiresAtMs: nowMs + expiresInSec * 1e3,
		scopes,
		accountId: readString(claims, "account_id"),
		subject: readString(claims, "sub")
	};
}
/** Decode a JWT payload without verifying it; the transport is HTTPS-authenticated. */
function decodeJwtPayload(token) {
	const segments = token.split(".");
	if (segments.length !== 3 || !segments[1]) return void 0;
	try {
		return asRecord(JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")));
	} catch {
		return;
	}
}
/** Normalize a scope claim that may arrive as a string or an array. */
function parseScopes(value) {
	if (typeof value === "string") return value.split(/\s+/u).filter(Boolean);
	if (Array.isArray(value) && value.every((scope) => typeof scope === "string")) return value.filter((scope) => typeof scope === "string");
	return [];
}
/** Narrow a JSON value to an object with readable string keys. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value) {
	return isRecord(value) ? value : void 0;
}
function readString(value, key) {
	const candidate = asRecord(value)?.[key];
	return typeof candidate === "string" && candidate.trim() ? candidate.trim() : void 0;
}
function readPositiveNumber(value, key) {
	const candidate = asRecord(value)?.[key];
	return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? candidate : void 0;
}
//#endregion
//#region src/store.ts
/** File-backed persistence for the MiniMax credential grant. */
/** Load a stored credential, treating any unreadable file as signed out. */
async function readCredential(path) {
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isMissing(error)) return void 0;
		throw error;
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null) return void 0;
	const record = parsed;
	if (record.schemaVersion !== 1) return void 0;
	if (record.clientId !== "mcode-public") return void 0;
	if (typeof record.accessToken !== "string" || !record.accessToken) return void 0;
	if (typeof record.refreshToken !== "string" || !record.refreshToken) return void 0;
	if (typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) return void 0;
	if (!Array.isArray(record.scopes) || !record.scopes.every((scope) => typeof scope === "string")) return void 0;
	if (!record.scopes.includes("agent.default")) return void 0;
	return {
		schemaVersion: 1,
		clientId: OAUTH_CLIENT_ID,
		accessToken: record.accessToken,
		refreshToken: record.refreshToken,
		expiresAtMs: record.expiresAtMs,
		scopes: record.scopes,
		accountId: typeof record.accountId === "string" ? record.accountId : void 0,
		subject: typeof record.subject === "string" ? record.subject : void 0,
		region: typeof record.region === "string" ? record.region : ""
	};
}
/** Persist a grant, replacing any previous record atomically. */
async function writeCredential(path, grant, region) {
	const record = {
		schemaVersion: 1,
		clientId: OAUTH_CLIENT_ID,
		accessToken: grant.accessToken,
		refreshToken: grant.refreshToken,
		expiresAtMs: grant.expiresAtMs,
		scopes: grant.scopes,
		accountId: grant.accountId,
		subject: grant.subject,
		region
	};
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
		encoding: "utf8",
		mode: 384
	});
	try {
		await chmod(temporary, 384);
	} catch {}
	await rename(temporary, path);
}
/** Remove any stored credential, tolerating an already-absent file. */
async function clearCredential(path) {
	try {
		await rm(path, { force: true });
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
}
function isMissing(error) {
	return typeof error === "object" && error !== null && error.code === "ENOENT";
}
/** The record this plugin owns. */
const GRANT_KEY = credentialKey("llm-minimax-coding-plan", "default");
/**
* Validate an opaque payload back into a usable grant.
*
* Mirrors the file store's checks, so a record this plugin cannot interpret
* reads as signed out rather than as a half-working credential. The scope
* check matters most: a token without `agent.default` cannot call anything.
*/
function parseGrantPayload(payload) {
	if (typeof payload !== "object" || payload === null) return void 0;
	const record = payload;
	if (record.schemaVersion !== 1) return void 0;
	if (record.clientId !== "mcode-public") return void 0;
	if (typeof record.accessToken !== "string" || !record.accessToken) return void 0;
	if (typeof record.refreshToken !== "string" || !record.refreshToken) return void 0;
	if (typeof record.expiresAtMs !== "number" || !Number.isFinite(record.expiresAtMs)) return void 0;
	if (!Array.isArray(record.scopes) || !record.scopes.every((scope) => typeof scope === "string")) return void 0;
	if (!record.scopes.includes("agent.default")) return void 0;
	if (typeof record.region !== "string" || !record.region) return void 0;
	return {
		schemaVersion: 1,
		clientId: OAUTH_CLIENT_ID,
		accessToken: record.accessToken,
		refreshToken: record.refreshToken,
		expiresAtMs: record.expiresAtMs,
		scopes: record.scopes,
		accountId: typeof record.accountId === "string" ? record.accountId : void 0,
		subject: typeof record.subject === "string" ? record.subject : void 0,
		region: record.region
	};
}
/** Build the payload a grant is stored as. */
function grantPayload(grant, region) {
	return {
		schemaVersion: 1,
		clientId: OAUTH_CLIENT_ID,
		accessToken: grant.accessToken,
		refreshToken: grant.refreshToken,
		expiresAtMs: grant.expiresAtMs,
		scopes: grant.scopes,
		accountId: grant.accountId,
		subject: grant.subject,
		region
	};
}
/**
* Read the stored grant, preferring the credential seam.
*
* The file is consulted only when the seam holds nothing usable, so a grant
* written before this change — or by `signin.mjs` — is still honoured without
* a migration step.
*
* @param ctx - context whose credential store is read when one is mounted.
* @param filePath - fallback location of the legacy JSON record.
* @returns the grant, or undefined when signed out.
*/
async function readGrant(ctx, filePath) {
	const store = ctx.get("credentials");
	if (store !== void 0) {
		const record = await store.readRecord(GRANT_KEY);
		if (record?.kind === "grant") {
			const parsed = parseGrantPayload(record.payload);
			if (parsed !== void 0) return parsed;
		}
	}
	return readCredential(filePath);
}
/**
* Persist a grant through the seam, falling back to the file when none is mounted.
*
* @param ctx - context whose credential store is written when one is mounted.
* @param filePath - legacy location written only without a store.
* @param grant - the token set to persist.
* @param region - region whose account origin issued it.
*/
async function writeGrant(ctx, filePath, grant, region) {
	const store = ctx.get("credentials");
	if (store === void 0) {
		await writeCredential(filePath, grant, region);
		return;
	}
	await store.modifyRecord(GRANT_KEY, () => Promise.resolve({
		kind: "grant",
		payload: grantPayload(grant, region)
	}));
}
/**
* Remove the grant from both locations, so a stale file cannot outlive a sign-out.
*
* @param ctx - context whose credential store is cleared when one is mounted.
* @param filePath - legacy location cleared unconditionally.
*/
async function clearGrant(ctx, filePath) {
	const store = ctx.get("credentials");
	if (store !== void 0) await store.deleteRecord(GRANT_KEY);
	await clearCredential(filePath);
}
//#endregion
//#region src/account.ts
/**
* Account service owning the MiniMax credential: one interactive device
* authorization, then a self-refreshing access token.
*/
/**
* MiniMax Coding Plan credentials.
*
* The service hands out a token only for the origins this plugin is
* configured with, so a misrouted request cannot leak the grant to a host
* that happens to receive the header.
*/
var MinimaxAccount = class extends Service {
	options;
	state = { status: "signed-out" };
	signInAttempt;
	refreshInFlight;
	/** @param ctx - context owning this account. @param options - endpoints, storage, and test seams. */
	constructor(ctx, options) {
		super(ctx, "minimaxAccount");
		this.options = options;
	}
	/** Read the current account state. */
	getState() {
		return this.state;
	}
	/**
	* Sign in through the device-authorization grant, or join the attempt
	* already running. The first caller owns the browser prompt and the polling
	* loop; later callers await the same outcome.
	* @returns the state after the attempt settles.
	*/
	async signIn() {
		this.signInAttempt ??= this.runSignIn().finally(() => {
			this.signInAttempt = void 0;
		});
		return this.signInAttempt;
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
	async resolveToken(url) {
		if (!this.isAllowedOrigin(url)) return void 0;
		const stored = await readGrant(this.ctx, this.options.credentialsPath);
		if (!stored) return void 0;
		if (stored.region !== this.options.region) return void 0;
		const now = (this.options.client?.now ?? Date.now)();
		if (stored.expiresAtMs - now > 12e4) {
			this.state = {
				status: "authenticated",
				accountId: stored.accountId,
				expiresAtMs: stored.expiresAtMs
			};
			return stored.accessToken;
		}
		return (await this.refreshStored(stored)).accessToken;
	}
	/**
	* Drop a token the inference endpoint rejected.
	*
	* Only clears when the rejected token is still the stored one, so a late
	* 401 from a superseded login never signs out the current session.
	*
	* @param token - token captured by the rejected request.
	*/
	async rejectToken(token) {
		const stored = await readGrant(this.ctx, this.options.credentialsPath);
		if (!stored || stored.accessToken !== token) return;
		this.refreshInFlight = void 0;
		await clearGrant(this.ctx, this.options.credentialsPath);
		this.state = { status: "signed-out" };
		this.ctx.emit("minimax-account/signed-out");
	}
	/**
	* Revoke and remove the local grant. Local state is cleared even when the
	* revocation request fails, so sign-out always takes effect.
	*/
	async signOut() {
		this.refreshInFlight = void 0;
		const stored = await readGrant(this.ctx, this.options.credentialsPath);
		if (stored) try {
			await revokeRefreshToken(this.options.endpoints, stored.refreshToken, this.options.client);
		} catch (error) {
			this.ctx.logger.warn("minimax-account: revocation failed; removing the local grant anyway: %o", error);
		}
		await clearGrant(this.ctx, this.options.credentialsPath);
		this.state = { status: "signed-out" };
		this.ctx.emit("minimax-account/signed-out");
		return this.state;
	}
	/** Run one device authorization end to end. */
	async runSignIn() {
		const client = this.options.client;
		let authorization;
		try {
			authorization = await requestDeviceAuthorization(this.options.endpoints, client);
		} catch (error) {
			this.state = { status: "signed-out" };
			throw error;
		}
		this.state = {
			status: "authorizing",
			userCode: authorization.userCode,
			verificationUri: authorization.verificationUri,
			verificationUriComplete: authorization.verificationUriComplete,
			expiresInSec: authorization.expiresInSec
		};
		this.ctx.logger.info("minimax-account: open %s and enter code %s to finish sign-in (valid for %ds)", authorization.verificationUriComplete ?? authorization.verificationUri, authorization.userCode, authorization.expiresInSec);
		if (this.options.openBrowser !== false) openExternal(authorization.verificationUriComplete ?? authorization.verificationUri);
		try {
			const grant = await pollDeviceToken(this.options.endpoints, authorization, client);
			await writeGrant(this.ctx, this.options.credentialsPath, grant, this.options.region);
			this.state = {
				status: "authenticated",
				accountId: grant.accountId,
				expiresAtMs: grant.expiresAtMs
			};
			this.ctx.emit("minimax-account/authenticated");
			return this.state;
		} catch (error) {
			this.state = { status: "signed-out" };
			throw error;
		}
	}
	/** Refresh one stored grant, collapsing concurrent callers onto one request. */
	async refreshStored(stored) {
		this.refreshInFlight ??= (async () => {
			try {
				const grant = await refreshAccessToken(this.options.endpoints, stored.refreshToken, this.options.client);
				await writeGrant(this.ctx, this.options.credentialsPath, grant, this.options.region);
				const next = {
					schemaVersion: 1,
					clientId: stored.clientId,
					accessToken: grant.accessToken,
					refreshToken: grant.refreshToken,
					expiresAtMs: grant.expiresAtMs,
					scopes: grant.scopes,
					accountId: grant.accountId,
					subject: grant.subject,
					region: this.options.region
				};
				this.state = {
					status: "authenticated",
					accountId: next.accountId,
					expiresAtMs: next.expiresAtMs
				};
				return next;
			} catch (error) {
				if (error instanceof OAuthProtocolError && error.httpStatus !== void 0 && error.httpStatus < 500) {
					await clearGrant(this.ctx, this.options.credentialsPath);
					this.state = { status: "signed-out" };
				}
				throw error;
			} finally {
				this.refreshInFlight = void 0;
			}
		})();
		return this.refreshInFlight;
	}
	/**
	* Accept only the origins this plugin itself talks to.
	*
	* Comparing parsed URL components rather than prefixes rejects lookalikes
	* such as `https://agent.minimax.cn.evil.test`, a non-HTTPS scheme, an
	* explicit port, and embedded credentials. The allowlist is the two
	* configured origins — inference and quota — not "any host we know of", so
	* adding a destination is a deliberate edit rather than a side effect.
	*/
	isAllowedOrigin(url) {
		let candidate;
		try {
			candidate = new URL(url);
		} catch {
			return false;
		}
		if (candidate.protocol !== "https:" || candidate.username !== "" || candidate.password !== "" || candidate.port !== "") return false;
		return this.allowedOrigins().some((allowed) => {
			try {
				return candidate.origin === new URL(allowed).origin;
			} catch {
				return false;
			}
		});
	}
	/** Configured origins permitted to receive the grant. */
	allowedOrigins() {
		return [this.options.endpoints.inferenceOrigin, this.options.endpoints.quotaOrigin];
	}
};
/** Open a URL with the platform's default handler; failures are non-fatal. */
function openExternal(url) {
	let command;
	let args;
	if (process.platform === "win32") {
		command = "cmd";
		args = [
			"/c",
			"start",
			"",
			url
		];
	} else if (process.platform === "darwin") {
		command = "open";
		args = [url];
	} else {
		command = "xdg-open";
		args = [url];
	}
	try {
		spawn(command, args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true
		}).unref();
	} catch {}
}
//#endregion
//#region src/config.ts
/** Plugin configuration for the MiniMax Coding Plan provider. */
/** Default credential file, kept under the harness home when one is exported. */
function defaultCredentialsPath() {
	const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
	return join(home, "minimax-coding-plan", "credential.json");
}
const catalogModel = z.object({
	id: z.string().required(),
	name: z.string(),
	description: z.string(),
	contextWindow: z.number().step(1).min(1),
	maxTokens: z.number().step(1).min(1),
	inputModalities: z.array(z.union(["text", "image"])).min(1).default(["text"])
});
/** Schemastery schema, reusing every Messages protocol field. */
const Config = z.object({
	...deepSeekConfigFields,
	baseURL: z.string().volatile(),
	models: z.array(catalogModel).default([...DEFAULT_MODELS]).volatile(),
	region: z.union(["cn", "en"]).default("cn"),
	credentialsPath: z.string().default(defaultCredentialsPath()),
	openBrowser: z.boolean().default(true),
	consolePort: z.number().min(0).max(65535).default(0)
});
/** Region origins for one configured region. */
function endpointsFor(region) {
	return REGION_ENDPOINTS[region];
}
//#endregion
//#region src/authorization.ts
/** Method id for the device-authorization grant; the only method this flow offers. */
const METHOD = "device-code";
/**
* Offer MiniMax as something the operator can authorize.
*
* @param ctx - plugin lifetime; the registration is withdrawn with the fiber.
* @param config - parsed plugin configuration, read for region and browser policy.
*/
function registerMinimaxAuthorization(ctx, config) {
	const endpoints = endpointsFor(config.region);
	ctx.authorization.registerFlow({
		key: GRANT_KEY,
		label: "MiniMax Coding Plan",
		methods: [{
			id: METHOD,
			label: "Sign in with MiniMax"
		}],
		run: async (session) => {
			const authorization = await requestDeviceAuthorization(endpoints, {}, session.signal);
			const url = authorization.verificationUriComplete ?? authorization.verificationUri;
			session.notify({
				message: "Approve this request in your browser to finish signing in to MiniMax.",
				url,
				code: authorization.userCode
			});
			if (config.openBrowser !== false) openExternal(url);
			const grant = await pollDeviceToken(endpoints, authorization, {}, session.signal);
			await session.commit({
				kind: "grant",
				payload: grantPayload(grant, config.region)
			});
		}
	});
}
//#endregion
//#region src/page.ts
/**
* The console page, as one self-contained document.
*
* No build step, no CDN, no framework: the page is served by a loopback
* listener whose URL carries a per-process secret, so everything it needs can
* be inlined and nothing it loads can be a supply-chain path into the host.
* All state arrives as JSON from the two `fetch` calls below; the document
* never holds a credential.
*/
/**
* Render the page document.
* @param base - the tokenised path prefix every request is relative to.
* @returns a complete HTML document.
*/
function renderConsolePage(base) {
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>MiniMax Coding Plan</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d0f12; --panel: #16191e; --line: #262b33;
    --fg: #e6e9ef; --dim: #8b94a3; --accent: #f97316; --ok: #34d399; --bad: #f87171;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px; background: var(--bg); color: var(--fg);
    font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 620px; }
  h1 { font-size: 18px; margin: 0 0 2px; font-weight: 600; letter-spacing: .2px; }
  .sub { color: var(--dim); font-size: 12px; margin-bottom: 24px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .grow { flex: 1; }
  .pill { font-size: 11px; padding: 2px 9px; border-radius: 99px; border: 1px solid var(--line); color: var(--dim); }
  .pill.on { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
  .pill.off { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
  .pill.busy { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  button {
    font: inherit; padding: 7px 15px; border-radius: 7px; cursor: pointer;
    border: 1px solid var(--line); background: #1e2229; color: var(--fg); transition: .12s;
  }
  button:hover:not(:disabled) { background: #262b33; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #1a1207; font-weight: 600; }
  button.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .code { font-size: 20px; letter-spacing: 3px; font-weight: 600; color: var(--accent); }
  .meta { color: var(--dim); font-size: 12px; margin-top: 10px; }
  a { color: var(--accent); }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 18px; }
  .seg button { border: 0; border-radius: 0; padding: 6px 16px; background: transparent; color: var(--dim); }
  .seg button[aria-pressed="true"] { background: #262b33; color: var(--fg); }
  .bar { height: 9px; background: #23272f; border-radius: 99px; overflow: hidden; margin: 7px 0 4px; }
  .bar > i { display: block; height: 100%; background: var(--accent); border-radius: 99px; transition: width .3s; }
  .bar.unlimited > i { background: var(--ok); }
  .legend { display: flex; justify-content: space-between; color: var(--dim); font-size: 12px; }
  .err { color: var(--bad); font-size: 12px; margin-top: 10px; }
  .foot { color: var(--dim); font-size: 11px; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
<main>
  <h1>MiniMax Coding Plan</h1>
  <div class="sub">DeepSeek Harness provider &middot; <span id="region">&mdash;</span></div>

  <div class="card">
    <div class="row">
      <span class="grow"><span class="pill" id="pill">读取中</span></span>
      <button class="primary" id="signin" disabled>登录</button>
      <button id="signout" disabled>登出</button>
    </div>
    <div id="body"></div>
  </div>

  <div class="card">
    <div class="seg">
      <button id="tab-interval" aria-pressed="true">本周期</button>
      <button id="tab-weekly" aria-pressed="false">本周</button>
    </div>
    <div id="quota"><div class="meta">尚未登录，暂无用量数据。</div></div>
    <div class="foot" id="stamp"></div>
  </div>
</main>

<script>
(function () {
  var BASE = ${JSON.stringify(base)};
  var $ = function (id) { return document.getElementById(id); };
  var tab = 'interval';
  var timer = null;

  // The service's own fields go into innerHTML, so escape rather than trust:
  // only the verification URL is interpolated, and it is escaped here.
  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtReset(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setBusy(on) {
    $('signin').disabled = on;
    $('signout').disabled = on;
  }

  function renderAccount(s) {
    var pill = $('pill'), body = $('body'), err = $('err');
    if (err) err.remove();
    pill.className = 'pill';

    if (s.status === 'signed-out') {
      pill.textContent = '未登录';
      setBusy(false);
      $('signin').disabled = false;
      $('signout').disabled = true;
      body.innerHTML = '<div class="meta">点击「登录」，浏览器会打开 MiniMax 验证页，'
        + '输入设备码后本页面会自动刷新。</div>';
    } else if (s.status === 'authorizing') {
      pill.textContent = '等待授权';
      pill.className = 'pill busy';
      setBusy(true);
      var href = esc(s.verificationUriComplete || s.verificationUri);
      body.innerHTML = '<div style="margin-top:14px">'
        + '<div class="meta">在浏览器中打开验证页并输入设备码：</div>'
        + '<div class="row" style="margin-top:8px"><span class="code">' + s.userCode + '</span>'
        + '<a class="grow" href="' + href + '" target="_blank" rel="noreferrer">打开验证页 &rarr;</a></div>'
        + '<div class="meta">有效期 ' + s.expiresInSec + ' 秒，页面每 2 秒自动检查。</div></div>';
    } else {
      pill.textContent = '已登录';
      pill.className = 'pill on';
      setBusy(false);
      $('signin').disabled = true;
      $('signout').disabled = false;
      body.innerHTML = '<div class="meta">账号 ' + (s.accountId || '&mdash;')
        + ' &middot; 令牌到期 ' + fmtReset(s.expiresAtMs) + '</div>';
    }
  }

  function renderQuota(q) {
    var host = $('quota');
    if (!q) { host.innerHTML = '<div class="meta">暂无用量数据。</div>'; return; }
    var w = null;
    for (var i = 0; i < q.windows.length; i++) if (q.windows[i].id === tab) w = q.windows[i];
    if (!w) { host.innerHTML = '<div class="meta">暂无用量数据。</div>'; return; }
    if (!w.present) {
      host.innerHTML = '<div class="meta">当前套餐未计量「' + w.label + '」额度。</div>';
      return;
    }
    var pct = w.totalPercent > 0 ? Math.round(w.usedPercent / w.totalPercent * 100) : 0;
    var left = Math.max(0, w.totalPercent - w.usedPercent);
    var bar = w.unlimited
      ? '<div class="bar unlimited"><i style="width:100%"></i></div>'
      : '<div class="bar"><i style="width:' + pct + '%"></i></div>';
    host.innerHTML = '<div class="row"><span class="grow" style="font-weight:600">' + w.label + '</span>'
      + (w.unlimited ? '<span class="pill on">不限量</span>' : '') + '</div>'
      + bar
      + '<div class="legend"><span>已用 ' + pct + '%</span><span>剩余 '
      + (w.unlimited ? '不限' : Math.round(left / w.totalPercent * 100) + '%') + '</span></div>'
      + (w.resetAtMs ? '<div class="meta" style="margin-top:10px">重置时间 ' + fmtReset(w.resetAtMs) + '</div>' : '');
    $('stamp').textContent = q.planLabel
      ? '套餐 ' + q.planLabel + ' · 数据取自 ' + new Date(q.fetchedAtMs).toLocaleTimeString()
      : '数据取自 ' + new Date(q.fetchedAtMs).toLocaleTimeString();
  }

  function refresh() {
    fetch(BASE + 'api/state', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (s) {
        $('region').textContent = '区域 ' + s.region;
        renderAccount(s);
        if (s.status === 'authorizing' && !timer) {
          timer = setInterval(refresh, 2000);
        } else if (s.status !== 'authorizing' && timer) {
          clearInterval(timer); timer = null;
        }
        if (s.quota) renderQuota(s.quota);
        else { $('quota').innerHTML = '<div class="meta">' + (s.quotaError || '暂无用量数据。') + '</div>'; $('stamp').textContent = ''; }
      })
      .catch(function (e) {
        var host = $('quota');
        if (!host.querySelector('.err')) {
          host.innerHTML = '<div class="err">读取失败：' + e.message + '</div>';
        }
      });
  }

  function act(endpoint) {
    setBusy(true);
    fetch(BASE + 'api/' + endpoint, { method: 'POST', cache: 'no-store' })
      .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || r.status); return b; }); })
      .then(refresh)
      .catch(function (e) {
        var body = $('body');
        var old = body.querySelector('.err');
        if (old) old.remove();
        var div = document.createElement('div');
        div.className = 'err'; div.textContent = e.message;
        body.appendChild(div);
        setBusy(false);
      });
  }

  $('signin').onclick = function () { act('sign-in'); };
  $('signout').onclick = function () { act('sign-out'); };
  $('tab-interval').onclick = function () { tab = 'interval'; $('tab-interval').setAttribute('aria-pressed', 'true'); $('tab-weekly').setAttribute('aria-pressed', 'false'); refresh(); };
  $('tab-weekly').onclick = function () { tab = 'weekly'; $('tab-weekly').setAttribute('aria-pressed', 'true'); $('tab-interval').setAttribute('aria-pressed', 'false'); refresh(); };
  refresh();
})();
<\/script>
</body>
</html>
`;
}
//#endregion
//#region src/quota.ts
/** Raised when the service answers but the grant is not usable. */
var QuotaAuthError = class extends Error {
	statusCode;
	constructor(statusCode, message) {
		super(message);
		this.statusCode = statusCode;
		this.name = "QuotaAuthError";
	}
};
/** Raised when the request never reached the service. */
var QuotaNetworkError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "QuotaNetworkError";
	}
};
/**
* Server status codes that mean "this grant will not work, sign in again".
*
* `1004` is `not login` — the service saw no credential at all. `1016` is
* `invalid api key`, which is what the same service answers when a credential
* *is* present but rejected. Verified against the live endpoint: an omitted
* credential and a rejected one produce different codes, so mapping only the
* first would report a stale grant as a transient network problem and never
* offer the operator a way back in.
*/
const AUTH_STATUS_CODES = /* @__PURE__ */ new Set([1004, 1016]);
/** Window status meaning the allowance does not actually cap usage. */
const UNLIMITED_STATUS = 3;
/**
* The wire sends percentages as strings, sometimes with a trailing `%`, and
* omits the field entirely for a window the plan does not meter.
* @param value - the raw field, of unknown shape.
* @returns the number, or undefined when the field is absent or unusable.
*/
function parsePercent(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
	if (typeof value !== "string") return void 0;
	const text = value.trim().replace(/%$/u, "").trim();
	if (!text) return void 0;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : void 0;
}
/** Allowance total, defaulting to a full window when the server omits it. */
function toTotal(value) {
	const parsed = parsePercent(value);
	return parsed !== void 0 && parsed > 0 ? parsed : 100;
}
/** Consumed share, clamped at zero and treated as absent-but-zero. */
function toUsed(value) {
	const parsed = parsePercent(value);
	return parsed === void 0 ? 0 : Math.max(0, parsed);
}
/** Parse a reset instant that may be epoch seconds, millis, or ISO-ish text. */
function toResetAt(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value > 0 ? value > 1e11 ? value : value * 1e3 : void 0;
	if (typeof value === "string" && value.trim()) {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
}
/** Coerce an arbitrary percentage into a 0..100 whole number. */
function clampPercent(value) {
	return Math.max(0, Math.min(100, Math.round(value)));
}
/** Build one window from the response's paired total/used/status fields. */
function readWindow(source, id, label, totalField, usedField, statusField, resetField) {
	const total = toTotal(source[totalField]);
	const used = clampPercent(toUsed(source[usedField]));
	return {
		id,
		label,
		totalPercent: clampPercent(total),
		usedPercent: Math.min(used, clampPercent(total)),
		resetAtMs: toResetAt(source[resetField]),
		unlimited: source[statusField] === UNLIMITED_STATUS,
		present: source[totalField] !== void 0 || source[usedField] !== void 0 || source[statusField] !== void 0 || source[resetField] !== void 0
	};
}
/**
* Read the current allowance windows.
*
* The token is sent as a bare `token` header, not `Authorization: Bearer` —
* that is the header this service checks, and a bearer header alone answers
* `1004` even with a valid grant.
*
* @param options - the grant to read with and the origins to read from.
* @returns the parsed windows, or an empty list when the plan meters neither.
* @throws {QuotaAuthError} when the service rejects the grant.
* @throws {QuotaNetworkError} when the request could not be completed.
*/
async function fetchQuota(options) {
	const doFetch = options.fetchImpl ?? fetch;
	const now = (options.now ?? Date.now)();
	const url = `${options.endpoints.quotaOrigin}/backend/account/token_plan/remains_percent`;
	let payload;
	try {
		const response = await doFetch(url, {
			method: "GET",
			headers: {
				token: options.token,
				"content-type": "application/json",
				accept: "application/json"
			}
		});
		const text = await response.text();
		try {
			payload = JSON.parse(text);
		} catch {
			throw new QuotaNetworkError(`quota service returned a non-JSON body (HTTP ${response.status})`);
		}
	} catch (error) {
		if (error instanceof QuotaNetworkError) throw error;
		throw new QuotaNetworkError(`could not reach the MiniMax quota service: ${String(error)}`, { cause: error });
	}
	if (payload === null || typeof payload !== "object") throw new QuotaNetworkError("quota service returned a body that is not an object");
	const body = payload;
	const base = body.base_resp ?? {};
	const code = base.status_code;
	if (code !== void 0 && code !== 0) {
		if (AUTH_STATUS_CODES.has(code)) throw new QuotaAuthError(code, base.status_msg ?? "the MiniMax grant was rejected");
		throw new QuotaNetworkError(`quota service error ${String(code)}: ${base.status_msg ?? "unknown"}`);
	}
	const source = body.data !== null && typeof body.data === "object" ? body.data : body;
	const windows = [readWindow(source, "interval", "本周期（5 小时窗口）", "current_interval_total_percent", "current_interval_used_percent", "current_interval_status", "end_time"), readWindow(source, "weekly", "本周", "current_weekly_total_percent", "current_weekly_used_percent", "current_weekly_status", "weekly_end_time")];
	const planName = source.plan_name ?? source.planName ?? body.plan_name;
	return {
		windows,
		planLabel: typeof planName === "string" && planName.trim() ? planName : void 0,
		fetchedAtMs: now
	};
}
//#endregion
//#region src/console.ts
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
/** Loopback authorities a request may name, with or without the port. */
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]",
	"::1"
]);
/** Flatten the account's discriminated state into the wire shape. */
function toWire(state, region) {
	if (state.status === "authorizing") return {
		status: "authorizing",
		userCode: state.userCode,
		verificationUri: state.verificationUri,
		verificationUriComplete: state.verificationUriComplete,
		expiresInSec: state.expiresInSec,
		region
	};
	if (state.status === "authenticated") return {
		status: "authenticated",
		accountId: state.accountId,
		expiresAtMs: state.expiresAtMs,
		region
	};
	return {
		status: "signed-out",
		region
	};
}
/** Reject anything not addressed to this loopback listener. */
function isLoopbackHost(req) {
	const raw = req.headers.host;
	if (!raw) return false;
	const host = raw.startsWith("[") ? raw.slice(0, raw.indexOf("]") + 1) : raw.split(":")[0] ?? "";
	return LOOPBACK_HOSTS.has(host.toLowerCase());
}
/**
* The console's HTTP listener.
*
* Exposed as a service so the harness owns its lifetime: disabling the plugin
* closes the socket, and an unreachable console is the intended failure mode.
*/
var MinimaxConsole = class extends Service {
	options;
	secret;
	server;
	port = 0;
	/** @param ctx - context owning this listener. @param options - account, origins, and port. */
	constructor(ctx, options) {
		super(ctx, "minimaxConsole");
		this.options = options;
		this.secret = randomBytes(24).toString("base64url");
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
	async start() {
		if (this.server) return this.url();
		const server = createServer((req, res) => {
			this.handle(req, res).catch((error) => {
				this.ctx.logger.error("minimax-console: request failed: %o", error);
				if (!res.headersSent) json(res, 500, { error: "the console request failed" });
			});
		});
		const port = await new Promise((resolve) => {
			server.once("error", (error) => {
				this.ctx.logger.warn("minimax-console: could not listen: %o", error);
				resolve(void 0);
			});
			server.listen(this.options.port ?? 0, "127.0.0.1", () => {
				const address = server.address();
				resolve(typeof address === "object" && address ? address.port : void 0);
			});
		});
		if (port === void 0) {
			server.close();
			return;
		}
		this.server = server;
		this.port = port;
		this.ctx.logger.info("minimax-console: open %s", this.url());
		return this.url();
	}
	/** The tokenised console URL. */
	url() {
		return `http://127.0.0.1:${this.port}/${this.secret}/`;
	}
	/** Release the socket when the fiber is torn down. */
	async stop() {
		const server = this.server;
		if (!server) return;
		this.server = void 0;
		await new Promise((resolve) => {
			server.close(() => {
				resolve();
			});
		});
	}
	/** Route one request, or refuse it. */
	async handle(req, res) {
		if (!isLoopbackHost(req)) {
			res.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
			res.end("this listener only answers loopback requests\n");
			return;
		}
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const base = `/${this.secret}/`;
		if (!url.pathname.startsWith(base)) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("not found\n");
			return;
		}
		const route = url.pathname.slice(base.length);
		if (req.method === "GET" && route === "") {
			const html = renderConsolePage(base);
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
				"x-content-type-options": "nosniff",
				"referrer-policy": "no-referrer"
			});
			res.end(html);
			return;
		}
		if (req.method === "GET" && route === "api/state") {
			json(res, 200, await this.state());
			return;
		}
		if (req.method === "POST" && (route === "api/sign-in" || route === "api/sign-out")) {
			await this.readBody(req);
			if (route === "api/sign-in") this.beginSignIn();
			else await this.options.account.signOut();
			json(res, 200, await this.state());
			return;
		}
		res.writeHead(405, {
			"content-type": "text/plain; charset=utf-8",
			allow: "GET, POST"
		});
		res.end("method not allowed\n");
	}
	/**
	* Start a sign-in without waiting for it.
	*
	* The device grant takes as long as the operator takes to approve it, so the
	* request returns as soon as the attempt is under way and the page polls
	* `api/state` until the status settles. `MinimaxAccount.signIn` already
	* collapses concurrent callers onto one attempt, so a double click is safe.
	*/
	beginSignIn() {
		this.options.account.signIn().catch((error) => {
			this.ctx.logger.warn("minimax-console: sign-in attempt ended: %o", error);
		});
	}
	/** Assemble one poll: account state, plus quota when a grant is usable. */
	async state() {
		const state = this.options.account.getState();
		const base = toWire(state, this.options.region);
		if (state.status !== "authenticated") return base;
		const token = await this.options.account.resolveToken(this.options.endpoints.quotaOrigin);
		if (token === void 0) return base;
		try {
			const quota = await fetchQuota({
				token,
				endpoints: this.options.endpoints,
				fetchImpl: this.options.fetchImpl,
				now: this.options.now
			});
			return {
				...base,
				quota
			};
		} catch (error) {
			if (error instanceof QuotaAuthError) {
				this.ctx.logger.warn("minimax-console: usage read rejected the grant (%d): %s", error.statusCode, error.message);
				return {
					...base,
					quotaError: "登录状态已失效，请重新登录。"
				};
			}
			this.ctx.logger.warn("minimax-console: usage read failed: %o", error);
			return {
				...base,
				quotaError: `读取用量失败：${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
	/** Consume a request body, refusing anything oversized. */
	async readBody(req) {
		const limit = 4096;
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > limit) throw new Error("request body too large");
		}
	}
};
/** Write one JSON response. */
function json(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(payload);
}
//#endregion
//#region src/index.ts
const name = "llm-minimax-coding-plan";
const inject = ["llm"];
/** Provider route this plugin owns. */
const PROVIDER = "minimax-coding-plan";
/**
* Register the account service and the provider route backed by it.
* @param ctx - context owning this plugin lifetime with the LLM registry injected.
* @param config - parsed plugin configuration.
*/
function apply(ctx, config) {
	const region = config.region;
	const endpoints = endpointsFor(region);
	ctx.inject(["authorization"], (child) => {
		registerMinimaxAuthorization(child, config);
	});
	const account = new MinimaxAccount(ctx, {
		endpoints,
		region,
		credentialsPath: config.credentialsPath,
		openBrowser: config.openBrowser
	});
	const console_ = new MinimaxConsole(ctx, {
		account,
		endpoints,
		region,
		port: config.consolePort
	});
	ctx.inject([console_], () => {
		console_.start();
	});
	const options = () => {
		const plain = plainOptions(config);
		return resolveAdapterOptions({
			...plain,
			baseURL: plain.baseURL ?? endpoints.inferenceOrigin
		});
	};
	const resolveAuth = async (connection) => {
		const token = await account.resolveToken(connection.baseURL);
		if (token === void 0) throw new LlmError("Sign in to MiniMax to use the Coding Plan provider. Run the `llm-minimax-coding-plan` sign-in, or enable automatic sign-in.", "ACCOUNT_SIGN_IN_REQUIRED");
		return {
			headers: { Authorization: `Bearer ${token}` },
			onRequestError: async (error) => {
				if (!(error instanceof LlmError)) return error;
				if (error.code === QUOTA_EXCEEDED_CODE) return new LlmError(error.message, ACCOUNT_QUOTA_EXCEEDED_CODE, {
					...error.failure,
					cause: error
				});
				if (error.failure.status !== 401) return error;
				try {
					await account.rejectToken(token);
				} catch (error) {
					ctx.logger.warn("minimax-coding-plan: could not retire the rejected token: %o", error);
				}
				return new LlmError("The MiniMax access token was rejected. Sign in again to continue.", "ACCOUNT_TOKEN_INVALID", {
					...error.failure,
					cause: error
				});
			}
		};
	};
	ctx.llm.registerConfigurableProviders([{
		provider: PROVIDER,
		displayName: "MiniMax Coding Plan",
		settingsNs: ctx.fiber.entry?.options.id ?? "llm-minimax-coding-plan",
		settingsPath: []
	}]);
	registerDeepSeekProvider(ctx, PROVIDER, {
		options,
		resolveAuth,
		providerName: "MiniMax Coding Plan",
		discoverModels: async (provider) => {
			try {
				await resolveAuth(options());
			} catch (error) {
				if (error instanceof LlmError && error.code === "ACCOUNT_SIGN_IN_REQUIRED") return [];
				throw error;
			}
			return options().models.map((model) => catalogModelInfo(provider, model));
		}
	});
}
//#endregion
export { Config, GRANT_KEY, MinimaxAccount, MinimaxConsole, OAUTH_AUDIENCE, OAUTH_CLIENT_ID, OAUTH_SCOPE, OAuthProtocolError, QuotaAuthError, QuotaNetworkError, REGION_ENDPOINTS, TOKEN_REFRESH_MARGIN_MS, apply, clearCredential, clearGrant, defaultCredentialsPath, endpointsFor, fetchQuota, grantPayload, inject, name, parseGrantPayload, pollDeviceToken, readCredential, readGrant, refreshAccessToken, registerMinimaxAuthorization, requestDeviceAuthorization, revokeRefreshToken, writeCredential, writeGrant };

//# sourceMappingURL=index.js.map