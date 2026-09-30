import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { checkAnthropicAccess, describeAnthropicAccessError, describeModelError } from "@/lib/llm/accessCheck";

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

describe("describeModelError", () => {
  it("says an unknown model can't be used", () => {
    const err = apiError(404, "not_found_error", "model: claude-nope");
    expect(describeModelError("MODEL_FAST", "claude-nope", err, false)).toBe(`MODEL_FAST is "claude-nope", which isn't a model this key can use`);
  });

  it("prefixes other failures with the variable and model", () => {
    const err = apiError(500, "api_error", "Internal server error");
    expect(describeModelError("MODEL_SMART", "claude-x", err, false)).toBe(
      `MODEL_SMART ("claude-x"): the Anthropic API check failed (500: Internal server error)`,
    );
  });
});

describe("checkAnthropicAccess", () => {
  const env = { ANTHROPIC_API_KEY: "sk-test", MODEL_SMART: "claude-smart", MODEL_FAST: "claude-fast" };
  const ok = async () => ({});

  it("passes when the key and both models check out, looking up each configured model", async () => {
    const looked: string[] = [];
    const retrieveModel = async (_: unknown, model: string) => {
      looked.push(model);
    };
    expect(await checkAnthropicAccess(env, { listModels: ok, retrieveModel })).toEqual([]);
    expect(looked.sort()).toEqual(["claude-fast", "claude-smart"]);
  });

  it("reports only the key problem, without looking up models, when the key check fails", async () => {
    let looked = false;
    const listModels = async () => {
      throw apiError(400, "invalid_request_error", UNSCOPED);
    };
    const retrieveModel = async () => {
      looked = true;
    };
    const problems = await checkAnthropicAccess(env, { listModels, retrieveModel });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not scoped to a workspace");
    expect(looked).toBe(false);
  });

  it("reports each unknown model", async () => {
    const retrieveModel = async (_: unknown, model: string) => {
      if (model === "claude-fast") throw apiError(404, "not_found_error", `model: ${model}`);
    };
    expect(await checkAnthropicAccess(env, { listModels: ok, retrieveModel })).toEqual([
      `MODEL_FAST is "claude-fast", which isn't a model this key can use`,
    ]);
  });

  it("skips unset models, leaving them to the env-var check", async () => {
    const looked: string[] = [];
    const retrieveModel = async (_: unknown, model: string) => {
      looked.push(model);
    };
    expect(await checkAnthropicAccess({ ANTHROPIC_API_KEY: "sk-test", MODEL_FAST: "claude-fast" }, { listModels: ok, retrieveModel })).toEqual([]);
    expect(looked).toEqual(["claude-fast"]);
  });

  it("makes no request when no key is set", async () => {
    let called = false;
    const listModels = async () => {
      called = true;
    };
    expect(await checkAnthropicAccess({ MODEL_FAST: "claude-fast" }, { listModels, retrieveModel: listModels })).toEqual([]);
    expect(called).toBe(false);
  });
});
