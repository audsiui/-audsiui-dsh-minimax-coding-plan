import { z } from "zod";
//#region lib/types/generated/remote.js
let _audsiui_dsh_minimax_coding_plan_minimax_quota_result$schema$value;
const _audsiui_dsh_minimax_coding_plan_minimax_quota_result$schema = () => _audsiui_dsh_minimax_coding_plan_minimax_quota_result$schema$value ??= z.object({
	"windows": z.array(z.object({
		"id": z.string().readonly(),
		"label": z.string().readonly(),
		"totalPercent": z.number().readonly(),
		"usedPercent": z.number().readonly(),
		"resetAtMs": z.union([z.literal(null), z.number()]).readonly(),
		"unlimited": z.boolean().readonly(),
		"present": z.boolean().readonly()
	})).readonly(),
	"planLabel": z.union([z.literal(null), z.string()]).readonly(),
	"fetchedAtMs": z.number().readonly(),
	"authExpired": z.boolean().readonly(),
	"error": z.union([z.literal(null), z.string()]).readonly()
});
let _audsiui_dsh_minimax_coding_plan_minimax_signIn_result$schema$value;
const _audsiui_dsh_minimax_coding_plan_minimax_signIn_result$schema = () => _audsiui_dsh_minimax_coding_plan_minimax_signIn_result$schema$value ??= z.object({
	"status": z.union([
		z.literal("signed-out"),
		z.literal("authorizing"),
		z.literal("authenticated")
	]).readonly(),
	"userCode": z.union([z.literal(null), z.string()]).readonly(),
	"verificationUri": z.union([z.literal(null), z.string()]).readonly(),
	"expiresInSec": z.union([z.literal(null), z.number()]).readonly(),
	"accountId": z.union([z.literal(null), z.string()]).readonly(),
	"expiresAtMs": z.union([z.literal(null), z.number()]).readonly(),
	"region": z.string().readonly()
});
let _audsiui_dsh_minimax_coding_plan_minimax_signOut_result$schema$value;
const _audsiui_dsh_minimax_coding_plan_minimax_signOut_result$schema = () => _audsiui_dsh_minimax_coding_plan_minimax_signOut_result$schema$value ??= z.object({
	"status": z.union([
		z.literal("signed-out"),
		z.literal("authorizing"),
		z.literal("authenticated")
	]).readonly(),
	"userCode": z.union([z.literal(null), z.string()]).readonly(),
	"verificationUri": z.union([z.literal(null), z.string()]).readonly(),
	"expiresInSec": z.union([z.literal(null), z.number()]).readonly(),
	"accountId": z.union([z.literal(null), z.string()]).readonly(),
	"expiresAtMs": z.union([z.literal(null), z.number()]).readonly(),
	"region": z.string().readonly()
});
let _audsiui_dsh_minimax_coding_plan_minimax_state_result$schema$value;
const _audsiui_dsh_minimax_coding_plan_minimax_state_result$schema = () => _audsiui_dsh_minimax_coding_plan_minimax_state_result$schema$value ??= z.object({
	"status": z.union([
		z.literal("signed-out"),
		z.literal("authorizing"),
		z.literal("authenticated")
	]).readonly(),
	"userCode": z.union([z.literal(null), z.string()]).readonly(),
	"verificationUri": z.union([z.literal(null), z.string()]).readonly(),
	"expiresInSec": z.union([z.literal(null), z.number()]).readonly(),
	"accountId": z.union([z.literal(null), z.string()]).readonly(),
	"expiresAtMs": z.union([z.literal(null), z.number()]).readonly(),
	"region": z.string().readonly()
});
const TYPERT_REMOTE = {
	package: "@audsiui/dsh-minimax-coding-plan",
	descriptors: [
		{
			id: "@audsiui/dsh-minimax-coding-plan#minimax/quota",
			service: "minimaxRemote",
			namespace: "minimax",
			method: "quota",
			invocation: { kind: "direct" },
			parameters: [],
			result: {
				mode: "strict",
				typeSymbol: "@audsiui/dsh-minimax-coding-plan/types#RemoteQuotaView",
				create: _audsiui_dsh_minimax_coding_plan_minimax_quota_result$schema
			},
			sourceLocation: {
				"file": "packages/@audsiui/dsh-minimax-coding-plan/src/remote.ts",
				"line": 191,
				"column": 9
			}
		},
		{
			id: "@audsiui/dsh-minimax-coding-plan#minimax/signIn",
			service: "minimaxRemote",
			namespace: "minimax",
			method: "signIn",
			invocation: { kind: "direct" },
			parameters: [],
			result: {
				mode: "strict",
				typeSymbol: "@audsiui/dsh-minimax-coding-plan/types#RemoteAccountView",
				create: _audsiui_dsh_minimax_coding_plan_minimax_signIn_result$schema
			},
			sourceLocation: {
				"file": "packages/@audsiui/dsh-minimax-coding-plan/src/remote.ts",
				"line": 155,
				"column": 9
			}
		},
		{
			id: "@audsiui/dsh-minimax-coding-plan#minimax/signOut",
			service: "minimaxRemote",
			namespace: "minimax",
			method: "signOut",
			invocation: { kind: "direct" },
			parameters: [],
			result: {
				mode: "strict",
				typeSymbol: "@audsiui/dsh-minimax-coding-plan/types#RemoteAccountView",
				create: _audsiui_dsh_minimax_coding_plan_minimax_signOut_result$schema
			},
			sourceLocation: {
				"file": "packages/@audsiui/dsh-minimax-coding-plan/src/remote.ts",
				"line": 175,
				"column": 9
			}
		},
		{
			id: "@audsiui/dsh-minimax-coding-plan#minimax/state",
			service: "minimaxRemote",
			namespace: "minimax",
			method: "state",
			invocation: { kind: "direct" },
			parameters: [],
			result: {
				mode: "strict",
				typeSymbol: "@audsiui/dsh-minimax-coding-plan/types#RemoteAccountView",
				create: _audsiui_dsh_minimax_coding_plan_minimax_state_result$schema
			},
			sourceLocation: {
				"file": "packages/@audsiui/dsh-minimax-coding-plan/src/remote.ts",
				"line": 130,
				"column": 3
			}
		}
	]
};
//#endregion
export { TYPERT_REMOTE, TYPERT_REMOTE as default };

//# sourceMappingURL=typert.remote-client.js.map