// Canned Anthropic beta Message responses for LLM client tests.
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

type FixtureOptions = {
  model?: string;
  stopReason?: BetaMessage["stop_reason"];
  refusalCategory?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  iterations?: unknown[];
};

export function textMessage(text: string, opts: FixtureOptions = {}): BetaMessage {
  const stopReason = opts.stopReason ?? "end_turn";
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: opts.model ?? "claude-sonnet-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details:
      stopReason === "refusal"
        ? { type: "refusal", category: opts.refusalCategory ?? null, explanation: null }
        : null,
    usage: {
      input_tokens: opts.inputTokens ?? 1_000,
      output_tokens: opts.outputTokens ?? 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      iterations: opts.iterations ?? null,
    },
  } as unknown as BetaMessage;
}

/** A valid output for the test schema in client.test.ts. */
export const VALID_LESSON = { title: "The Battle of Gaugamela", minutes: 15, keyTerms: ["phalanx"] };
