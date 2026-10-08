import type { Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type Config as ProtocolConfig } from '@deepseek-ai/dsh-llm-deepseek';
import { type Region, type RegionEndpoints } from './constants.ts';
/** Default credential file, kept under the harness home when one is exported. */
export declare function defaultCredentialsPath(): string;
/** One advisory catalog entry for the MiniMax route. */
export interface MinimaxCatalogModel {
    /** Wire model id accepted by the endpoint. */
    id: string;
    /** Selector label; defaults to {@link id}. */
    name?: string;
    /** Selector detail for plans that serve similar variants. */
    description?: string;
    /** Known combined request/response context capacity. */
    contextWindow?: number;
    /** Per-request output cap; omission falls back to the profile's `maxTokens`. */
    maxTokens?: number;
    /** Accepted request modalities; omission is text-only. */
    inputModalities?: ('text' | 'image')[];
    /**
     * Pixel budget every request image of this route is projected into, or `low`
     * for the transport's smallest grid. Omission projects through the
     * transport's own published grid, which belongs to DeepSeek rather than to
     * this route; declaring it here is what makes the rule the route's own.
     */
    imagePixelBudget?: number | 'low';
    /** Encoded-byte ceiling for one request image. Omission is 2 MiB. */
    imageMaxBytes?: number;
    /** `in-history`, when this route's system prompts are replayed in the history. */
    systemPromptUpdate?: 'in-history';
    /** How this route carries tool definitions across a replay. */
    toolUpdate?: 'in-history' | 'addition-only';
}
/**
 * MiniMax Coding Plan configuration.
 *
 * Extends the Messages protocol settings with the fields that select a region
 * and locate the credential. No API key exists for this route: the bearer
 * token always comes from the device-authorization grant.
 */
export interface Config extends Omit<ProtocolConfig, 'baseURL' | 'models'> {
    /** Messages root; defaults from {@link region}. Must not end in `/v1`. */
    baseURL: Volatile<string | undefined>;
    /** Account and inference region (default `cn`). Read once at load. */
    region: Region;
    /**
     * Advisory catalog. MiniMax serves no model-discovery route on this
     * endpoint, so the ids must be declared; only requests are unaffected by
     * entries that are wrong, but the selector shows them.
     */
    models: Volatile<MinimaxCatalogModel[]>;
    /** Absolute path of the credential file. Read once at load. */
    credentialsPath: string;
    /** Open the verification page automatically during sign-in. Read once at load. */
    openBrowser: boolean;
}
/** Schemastery schema, reusing every Messages protocol field. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    baseURL: z<string, string, "volatile">;
    models: z<NoInfer<({
        id?: string | null;
        name?: string | null;
        description?: string | null;
        contextWindow?: number | null;
        maxTokens?: number | null;
        inputModalities?: ("text" | "image")[] | null;
        imagePixelBudget?: number | "low" | null;
        imageMaxBytes?: number | null;
        systemPromptUpdate?: "in-history" | null;
        toolUpdate?: "in-history" | "addition-only" | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        name: z<string, string, "plain">;
        description: z<string, string, "plain">;
        contextWindow: z<number, number, "plain">;
        maxTokens: z<number, number, "plain">;
        inputModalities: z<("text" | "image")[], ("text" | "image")[], "defined">;
        imagePixelBudget: z<number | "low", number | "low", "plain">;
        imageMaxBytes: z<number, number, "plain">;
        systemPromptUpdate: z<"in-history", "in-history", "plain">;
        toolUpdate: z<"in-history" | "addition-only", "in-history" | "addition-only", "plain">;
    }>>[]>, "volatile-defined">;
    region: z<"cn" | "en", "cn" | "en", "defined">;
    credentialsPath: z<string, string, "defined">;
    openBrowser: z<boolean, boolean, "defined">;
    thinking: z<"enabled" | "disabled", "enabled" | "disabled", "volatile">;
    reasoningEffort: z<"low" | "off" | "high" | "max", "low" | "off" | "high" | "max", "volatile">;
    maxTokens: z<number, number, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    streamIdleTimeoutMs: z<number, number, "volatile-defined">;
    maxRequestFilesBytes: z<number, number, "volatile-defined">;
    maxInlineRequestImageBytes: z<number, number, "volatile-defined">;
    maxImagesPerRequest: z<number, number, "volatile-defined">;
    imageOffloadByteQuantum: z<number, number, "volatile-defined">;
    inlineImageOffloadByteQuantum: z<number, number, "volatile-defined">;
    imageOffloadCountQuantum: z<number, number, "volatile-defined">;
    filesApiTimeoutMs: z<number, number, "volatile-defined">;
    fileExpiresAfterSeconds: z<number, number, "volatile-defined">;
    fileRefreshMarginSeconds: z<number, number, "volatile-defined">;
    fileQuotaCleanupBatch: z<number, number, "volatile-defined">;
    retryPolicy: z<NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, "volatile">;
}>>, Schemastery.ObjectT<NoInfer<{
    baseURL: z<string, string, "volatile">;
    models: z<NoInfer<({
        id?: string | null;
        name?: string | null;
        description?: string | null;
        contextWindow?: number | null;
        maxTokens?: number | null;
        inputModalities?: ("text" | "image")[] | null;
        imagePixelBudget?: number | "low" | null;
        imageMaxBytes?: number | null;
        systemPromptUpdate?: "in-history" | null;
        toolUpdate?: "in-history" | "addition-only" | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        name: z<string, string, "plain">;
        description: z<string, string, "plain">;
        contextWindow: z<number, number, "plain">;
        maxTokens: z<number, number, "plain">;
        inputModalities: z<("text" | "image")[], ("text" | "image")[], "defined">;
        imagePixelBudget: z<number | "low", number | "low", "plain">;
        imageMaxBytes: z<number, number, "plain">;
        systemPromptUpdate: z<"in-history", "in-history", "plain">;
        toolUpdate: z<"in-history" | "addition-only", "in-history" | "addition-only", "plain">;
    }>>[]>, "volatile-defined">;
    region: z<"cn" | "en", "cn" | "en", "defined">;
    credentialsPath: z<string, string, "defined">;
    openBrowser: z<boolean, boolean, "defined">;
    thinking: z<"enabled" | "disabled", "enabled" | "disabled", "volatile">;
    reasoningEffort: z<"low" | "off" | "high" | "max", "low" | "off" | "high" | "max", "volatile">;
    maxTokens: z<number, number, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    streamIdleTimeoutMs: z<number, number, "volatile-defined">;
    maxRequestFilesBytes: z<number, number, "volatile-defined">;
    maxInlineRequestImageBytes: z<number, number, "volatile-defined">;
    maxImagesPerRequest: z<number, number, "volatile-defined">;
    imageOffloadByteQuantum: z<number, number, "volatile-defined">;
    inlineImageOffloadByteQuantum: z<number, number, "volatile-defined">;
    imageOffloadCountQuantum: z<number, number, "volatile-defined">;
    filesApiTimeoutMs: z<number, number, "volatile-defined">;
    fileExpiresAfterSeconds: z<number, number, "volatile-defined">;
    fileRefreshMarginSeconds: z<number, number, "volatile-defined">;
    fileQuotaCleanupBatch: z<number, number, "volatile-defined">;
    retryPolicy: z<NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, NoInfer<import("@deepseek-ai/dsh-llm").RetryPolicyConfig>, "volatile">;
}>>, "plain">;
/** Region origins for one configured region. */
export declare function endpointsFor(region: Region): RegionEndpoints;
//# sourceMappingURL=config.d.ts.map