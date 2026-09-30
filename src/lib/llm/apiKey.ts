/**
 * Env vars that can hold the Anthropic API key, in precedence order. The app-specific name exists
 * for hosts that reserve ANTHROPIC_API_KEY for their own use (e.g. Claude Code on the web) and may
 * not pass it through; when set, it wins, since it can only mean this app's key.
 */
export const ANTHROPIC_API_KEY_VARS = ["COURSEFORGE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"] as const;

/** The first non-blank key among ANTHROPIC_API_KEY_VARS, or undefined if none is set. */
export function findAnthropicApiKey(env: Record<string, string | undefined>): string | undefined {
  for (const name of ANTHROPIC_API_KEY_VARS) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
