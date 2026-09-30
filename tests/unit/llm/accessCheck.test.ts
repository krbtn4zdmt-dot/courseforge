import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { checkAnthropicAccess, describeAnthropicAccessError } from "@/lib/llm/accessCheck";

const UNSCOPED =
  "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.";

function apiError(status: number, type: string, message: string) {
  return Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());
}

describe("describeAnthropicAccessError", () => {
  it("names the workspace variables for an unscoped key", () => {
    const problem = describeAnthropicAccessError(apiError(400, "invalid_request_error", UNSCOPED), false);
    expect(problem).toContain("not scoped to a workspace");
    expect(problem).toContain("COURSEFORGE_ANTHROPIC_WORKSPACE_ID or ANTHROPIC_WORKSPACE_ID");
  });

  it("reports a rejected key", () => {
    expect(describeAnthropicAccessError(apiError(401, "authentication_error", "invalid x-api-key"), false)).toBe(
      "the Anthropic API rejected the key (401: invalid x-api-key)",
    );
  });

  it("points at the workspace ID when one is set and the request still fails", () => {
    expect(describeAnthropicAccessError(apiError(403, "permission_error", "no access"), true)).toBe(
      "the Anthropic API check failed (403: no access); check the workspace ID too",
    );
  });

  it("reports a connection failure with its message", () => {
    const err = new Anthropic.APIConnectionError({ message: "Connection error." });
    expect(describeAnthropicAccessError(err, false)).toBe("the Anthropic API check failed (Connection error.)");
  });
});

describe("checkAnthropicAccess", () => {
  it("passes when the request succeeds", async () => {
    expect(await checkAnthropicAccess({ ANTHROPIC_API_KEY: "sk-test" }, { listModels: async () => ({}) })).toBeUndefined();
  });

  it("returns the problem when the request fails", async () => {
    const listModels = async () => {
      throw apiError(400, "invalid_request_error", UNSCOPED);
    };
    expect(await checkAnthropicAccess({ ANTHROPIC_API_KEY: "sk-test" }, { listModels })).toContain("not scoped to a workspace");
  });

  it("makes no request when no key is set", async () => {
    let called = false;
    const listModels = async () => {
      called = true;
    };
    expect(await checkAnthropicAccess({}, { listModels })).toBeUndefined();
    expect(called).toBe(false);
  });
});
