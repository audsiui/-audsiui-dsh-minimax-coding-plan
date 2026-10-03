/** Plugin configuration for the MiniMax Coding Plan provider. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deepSeekConfigFields, type Config as ProtocolConfig } from '@deepseek-ai/dsh-llm-deepseek'
import { DEFAULT_MODELS, REGION_ENDPOINTS, type Region } from './constants.ts'

/** Default credential file, kept under the harness home when one is exported. */
export function defaultCredentialsPath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'minimax-coding-plan', 'credential.json')
}

/** One advisory catalog entry for the MiniMax route. */
export interface MinimaxCatalogModel {
  /** Wire model id accepted by the endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Selector detail for plans that serve similar variants. */
  description?: string
  /** Known combined request/response context capacity. */
  contextWindow?: number
  /** Per-request output cap; omission falls back to the profile's `maxTokens`. */
  maxTokens?: number
  /** Accepted request modalities; omission is text-only. */
  inputModalities?: ('text' | 'image')[]
}

const catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(['text', 'image'] as const)).min(1).default(['text']),
})

/**
 * MiniMax Coding Plan configuration.
 *
 * Extends the Messages protocol settings with the fields that select a region
 * and locate the credential. No API key exists for this route: the bearer
 * token always comes from the device-authorization grant.
 */
export interface Config extends Omit<ProtocolConfig, 'baseURL' | 'models'> {
  /** Messages root; defaults from {@link region}. Must not end in `/v1`. */
  baseURL: Volatile<string | undefined>
  /** Account and inference region (default `cn`). Read once at load. */
  region: Region
  /**
   * Advisory catalog. MiniMax serves no model-discovery route on this
   * endpoint, so the ids must be declared; only requests are unaffected by
   * entries that are wrong, but the selector shows them.
   */
  models: Volatile<MinimaxCatalogModel[]>
  /** Absolute path of the credential file. Read once at load. */
  credentialsPath: string
  /** Open the verification page automatically during sign-in. Read once at load. */
  openBrowser: boolean
}

/** Schemastery schema, reusing every Messages protocol field. */
export const Config = z.object({
  ...deepSeekConfigFields,
  // These two keys follow the spread so the provider ships MiniMax endpoints
  // and a MiniMax catalog instead of the DeepSeek defaults.
  baseURL: z.string().volatile(),
  models: z.array(catalogModel).default([...DEFAULT_MODELS]).volatile(),
  // Startup-only settings: nothing re-reads them after load, so they are not
  // volatile and are read straight off the parsed config.
  region: z.union(['cn', 'en'] as const).default('cn'),
  credentialsPath: z.string().default(defaultCredentialsPath()),
  openBrowser: z.boolean().default(true),
})

/** Region origins for one configured region. */
export function endpointsFor(region: Region): { accountOrigin: string; inferenceOrigin: string } {
  return REGION_ENDPOINTS[region]
}
