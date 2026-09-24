import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const quizSchema = z.object({
  question: z.string().min(5),
  options: z.array(z.string()).min(2),
  correctIndex: z.number().int().nonnegative(),
});

export const validQuizJson = JSON.stringify({
  question: "What does SUM() do in Excel?",
  options: ["Adds numbers", "Counts cells", "Finds the maximum"],
  correctIndex: 0,
});

// Parses as JSON but fails the schema: question too short, only one option.
export const schemaInvalidQuizJson = JSON.stringify({
  question: "Sum?",
  options: ["Adds numbers"],
  correctIndex: 0,
});

export const malformedJson = '{"question": "What does SUM() do?", "options": [';

export const fencedQuizJson = "```json\n" + validQuizJson + "\n```";

export function mockMessage(
  text: string,
  overrides: Partial<Anthropic.Message> = {},
  usage = { input_tokens: 1_000, output_tokens: 200 },
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
      output_tokens_details: null,
    },
    ...overrides,
  } as Anthropic.Message;
}
