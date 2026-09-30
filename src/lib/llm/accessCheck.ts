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

export interface AccessCheckDeps {
  /** The authenticated request to make; defaults to listing one model, which costs nothing. */
  listModels?: (anthropic: Anthropic) => Promise<unknown>;
}

/**
 * Makes one free authenticated request with the key and headers callJson uses, so a key the API
 * rejects (e.g. one not scoped to a workspace) fails the preflight instead of the first LLM call.
 * Returns the problem, or undefined if the request succeeded or no key is set (reported elsewhere).
 */
export async function checkAnthropicAccess(
  env: Record<string, string | undefined>,
  deps: AccessCheckDeps = {},
): Promise<string | undefined> {
  const apiKey = findAnthropicApiKey(env);
  if (!apiKey) return undefined;
  const anthropic = new Anthropic({ apiKey, defaultHeaders: anthropicDefaultHeaders(env), maxRetries: 0, timeout: 10_000 });
  const listModels = deps.listModels ?? ((client: Anthropic) => client.models.list({ limit: 1 }));
  try {
    await listModels(anthropic);
    return undefined;
  } catch (err) {
    return describeAnthropicAccessError(err, findAnthropicWorkspaceId(env) !== undefined);
  }
}
