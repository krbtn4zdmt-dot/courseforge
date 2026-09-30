/**
 * Env vars that can hold the Anthropic API key, in precedence order. The app-specific name exists
 * for hosts that reserve ANTHROPIC_API_KEY for their own use (e.g. Claude Code on the web) and may
 * not pass it through; when set, it wins, since it can only mean this app's key.
 */
export const ANTHROPIC_API_KEY_VARS = ["COURSEFORGE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"] as const;

/**
 * Env vars that can hold the Anthropic workspace ID, in the same precedence order as the key.
 * Only needed for keys not scoped to a workspace: the API rejects those unless each request
 * carries an anthropic-workspace-id header.
 */
export const ANTHROPIC_WORKSPACE_ID_VARS = ["COURSEFORGE_ANTHROPIC_WORKSPACE_ID", "ANTHROPIC_WORKSPACE_ID"] as const;

function firstSet(env: Record<string, string | undefined>, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** The first non-blank key among ANTHROPIC_API_KEY_VARS, or undefined if none is set. */
export function findAnthropicApiKey(env: Record<string, string | undefined>): string | undefined {
  return firstSet(env, ANTHROPIC_API_KEY_VARS);
}

/** The first non-blank workspace ID among ANTHROPIC_WORKSPACE_ID_VARS, or undefined if none is set. */
export function findAnthropicWorkspaceId(env: Record<string, string | undefined>): string | undefined {
  return firstSet(env, ANTHROPIC_WORKSPACE_ID_VARS);
}

/** Headers every Anthropic request needs beyond the key: anthropic-workspace-id when a workspace ID is set. */
export function anthropicDefaultHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const workspaceId = findAnthropicWorkspaceId(env);
  return workspaceId ? { "anthropic-workspace-id": workspaceId } : {};
}
