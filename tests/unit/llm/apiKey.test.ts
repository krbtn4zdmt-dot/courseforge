import { describe, expect, it } from "vitest";

import { findAnthropicApiKey } from "@/lib/llm/apiKey";

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
