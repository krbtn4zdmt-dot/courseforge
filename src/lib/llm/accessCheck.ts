import Anthropic from "@anthropic-ai/sdk";

import { ANTHROPIC_WORKSPACE_ID_VARS, anthropicDefaultHeaders, findAnthropicApiKey, findAnthropicWorkspaceId } from "./apiKey";

const UNSCOPED_KEY = /not scoped to a workspace/i;

/** A preflight problem for a failed Anthropic request, naming the fix when it's a known one. */
export function describeAnthropicAccessError(err: unknown, workspaceIdSet: boolean): string {
  if (!(err instanceof Anthropic.APIError) || err.status === undefined) {
    return `the Anthropic API check failed (${err instanceof Error ? err.message : String(err)})`;
  }
  const body = err.error as { error?: { message?: unknown } } | undefined;
  const detail = typeof body?.error?.message === "string" ? body.error.message : err.message;
  if (UNSCOPED_KEY.test(detail) && !workspaceIdSet) {
    return `the Anthropic API key is not scoped to a workspace: set ${ANTHROPIC_WORKSPACE_ID_VARS.join(" or ")} to the workspace's ID, or use a workspace-scoped key`;
  }
  if (err.status === 401) return `the Anthropic API rejected the key (401: ${detail})`;
  return `the Anthropic API check failed (${err.status}: ${detail})${workspaceIdSet ? "; check the workspace ID too" : ""}`;
}

/** A preflight problem for a configured model the API wouldn't look up. */
export function describeModelError(envVar: string, model: string, err: unknown, workspaceIdSet: boolean): string {
  if (err instanceof Anthropic.NotFoundError) return `${envVar} is "${model}", which isn't a model this key can use`;
  return `${envVar} ("${model}"): ${describeAnthropicAccessError(err, workspaceIdSet)}`;
}

/** The env vars callJson resolves model tiers from (see resolveModel in client.ts). */
const MODEL_VARS = ["MODEL_SMART", "MODEL_FAST"] as const;

export interface AccessCheckDeps {
  /** The key check; defaults to listing one model, which costs nothing. */
  listModels?: (anthropic: Anthropic) => Promise<unknown>;
  /** The per-model check; defaults to looking the model up, which costs nothing. */
  retrieveModel?: (anthropic: Anthropic, model: string) => Promise<unknown>;
}

/**
 * Makes free authenticated requests with the key and headers callJson uses, so a key the API
 * rejects (e.g. one not scoped to a workspace) or a model ID it doesn't know fails the preflight
 * instead of the first LLM call. The key is checked first, since every model lookup would fail
 * the same way. Returns the problems; unset variables are left to the env-var check.
 */
export async function checkAnthropicAccess(
  env: Record<string, string | undefined>,
  deps: AccessCheckDeps = {},
): Promise<string[]> {
  const apiKey = findAnthropicApiKey(env);
  if (!apiKey) return [];
  const workspaceIdSet = findAnthropicWorkspaceId(env) !== undefined;
  const anthropic = new Anthropic({ apiKey, defaultHeaders: anthropicDefaultHeaders(env), maxRetries: 0, timeout: 10_000 });
  const listModels = deps.listModels ?? ((client: Anthropic) => client.models.list({ limit: 1 }));
  const retrieveModel = deps.retrieveModel ?? ((client: Anthropic, model: string) => client.models.retrieve(model));
  try {
    await listModels(anthropic);
  } catch (err) {
    return [describeAnthropicAccessError(err, workspaceIdSet)];
  }
  const problems = await Promise.all(
    MODEL_VARS.map(async (envVar) => {
      const model = env[envVar];
      if (!model) return undefined;
      try {
        await retrieveModel(anthropic, model);
        return undefined;
      } catch (err) {
        return describeModelError(envVar, model, err, workspaceIdSet);
      }
    }),
  );
  return problems.filter((p): p is string => p !== undefined);
}
