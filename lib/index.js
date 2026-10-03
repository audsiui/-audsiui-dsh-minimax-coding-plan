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
		inferenceOrigin: "https://agent.minimax.cn/mavis/api/v1/llm"
	},
	en: {
		accountOrigin: "https://account.minimax.io",
		inferenceOrigin: "https://agent.minimax.io/mavis/api/v1/llm"
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
* The service hands out a token only for the inference origin it was
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
	* Accept only the configured inference origin.
	*
	* Comparing parsed URL components rather than prefixes rejects lookalikes
	* such as `https://agent.minimax.cn.evil.test`, a non-HTTPS scheme, an
	* explicit port, and embedded credentials.
	*/
	isAllowedOrigin(url) {
		let candidate;
		let allowed;
		try {
			candidate = new URL(url);
			allowed = new URL(this.options.endpoints.inferenceOrigin);
		} catch {
			return false;
		}
		return candidate.protocol === "https:" && candidate.host === allowed.host && candidate.username === "" && candidate.password === "" && candidate.port === "" && candidate.origin === allowed.origin;
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
	openBrowser: z.boolean().default(true)
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
export { Config, GRANT_KEY, MinimaxAccount, OAUTH_AUDIENCE, OAUTH_CLIENT_ID, OAUTH_SCOPE, OAuthProtocolError, REGION_ENDPOINTS, TOKEN_REFRESH_MARGIN_MS, apply, clearCredential, clearGrant, defaultCredentialsPath, endpointsFor, grantPayload, inject, name, parseGrantPayload, pollDeviceToken, readCredential, readGrant, refreshAccessToken, registerMinimaxAuthorization, requestDeviceAuthorization, revokeRefreshToken, writeCredential, writeGrant };

//# sourceMappingURL=index.js.map