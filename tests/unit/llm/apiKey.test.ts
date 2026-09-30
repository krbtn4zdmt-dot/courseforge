import { describe, expect, it } from "vitest";

import { findAnthropicApiKey, findAnthropicWorkspaceId } from "@/lib/llm/apiKey";

describe("findAnthropicApiKey", () => {
  it("reads ANTHROPIC_API_KEY", () => {
    expect(findAnthropicApiKey({ ANTHROPIC_API_KEY: "sk-std" })).toBe("sk-std");
  });

  it("falls back to COURSEFORGE_ANTHROPIC_API_KEY", () => {
    expect(findAnthropicApiKey({ COURSEFORGE_ANTHROPIC_API_KEY: "sk-app" })).toBe("sk-app");
  });

  it("prefers COURSEFORGE_ANTHROPIC_API_KEY when both are set", () => {
    expect(findAnthropicApiKey({ ANTHROPIC_API_KEY: "sk-std", COURSEFORGE_ANTHROPIC_API_KEY: "sk-app" })).toBe("sk-app");
  });

  it("skips blank values and trims whitespace", () => {
    expect(findAnthropicApiKey({ COURSEFORGE_ANTHROPIC_API_KEY: "  ", ANTHROPIC_API_KEY: " sk-std\n" })).toBe("sk-std");
  });

  it("returns undefined when neither is set", () => {
    expect(findAnthropicApiKey({})).toBeUndefined();
    expect(findAnthropicApiKey({ ANTHROPIC_API_KEY: "" })).toBeUndefined();
  });
});

describe("findAnthropicWorkspaceId", () => {
  it("reads ANTHROPIC_WORKSPACE_ID", () => {
    expect(findAnthropicWorkspaceId({ ANTHROPIC_WORKSPACE_ID: "wrkspc_std" })).toBe("wrkspc_std");
  });

  it("prefers COURSEFORGE_ANTHROPIC_WORKSPACE_ID when both are set", () => {
    expect(
      findAnthropicWorkspaceId({ ANTHROPIC_WORKSPACE_ID: "wrkspc_std", COURSEFORGE_ANTHROPIC_WORKSPACE_ID: "wrkspc_app" }),
    ).toBe("wrkspc_app");
  });

  it("skips blank values and trims whitespace", () => {
    expect(findAnthropicWorkspaceId({ COURSEFORGE_ANTHROPIC_WORKSPACE_ID: " ", ANTHROPIC_WORKSPACE_ID: " wrkspc_std\n" })).toBe("wrkspc_std");
  });

  it("returns undefined when neither is set", () => {
    expect(findAnthropicWorkspaceId({})).toBeUndefined();
  });
});
