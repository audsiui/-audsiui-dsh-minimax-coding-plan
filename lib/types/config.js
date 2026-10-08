/** Plugin configuration for the MiniMax Coding Plan provider. */
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { deepSeekConfigFields } from '@deepseek-ai/dsh-llm-deepseek';
import { DEFAULT_MODELS, REGION_ENDPOINTS } from "./constants.js";
/** Default credential file, kept under the harness home when one is exported. */
export function defaultCredentialsPath() {
    const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
    return join(home, 'minimax-coding-plan', 'credential.json');
}
/**
 * Catalog entry schema, matching the Messages protocol's own catalog rules.
 *
 * The four fields beyond image support are carried because the transport reads
 * them: a catalog entry that cannot express them cannot be configured with
 * them, and an absent rule silently falls back to a default chosen for a
 * different provider. Mirroring the protocol's schema is the whole fix — there
 * is no MiniMax-specific variant of any of them.
 */
const catalogModel = z.object({
    id: z.string().required(),
    name: z.string(),
    description: z.string(),
    contextWindow: z.number().step(1).min(1),
    maxTokens: z.number().step(1).min(1),
    inputModalities: z.array(z.union(['text', 'image'])).min(1).default(['text']),
    imagePixelBudget: z.union([z.number().step(1).min(1), z.const('low')]),
    imageMaxBytes: z.number().step(1).min(1),
    systemPromptUpdate: z.const('in-history'),
    toolUpdate: z.union(['in-history', 'addition-only']),
});
/** Schemastery schema, reusing every Messages protocol field. */
export const Config = z.object({
    ...deepSeekConfigFields,
    // These two keys follow the spread so the provider ships MiniMax endpoints
    // and a MiniMax catalog instead of the DeepSeek defaults.
    baseURL: z.string().volatile(),
    models: z.array(catalogModel).default([...DEFAULT_MODELS]).volatile(),
    // Startup-only settings: nothing re-reads them after load, so they are not
    // volatile and are read straight off the parsed config.
    region: z.union(['cn', 'en']).default('cn'),
    credentialsPath: z.string().default(defaultCredentialsPath()),
    openBrowser: z.boolean().default(true),
});
/** Region origins for one configured region. */
export function endpointsFor(region) {
    return REGION_ENDPOINTS[region];
}
//# sourceMappingURL=config.js.map