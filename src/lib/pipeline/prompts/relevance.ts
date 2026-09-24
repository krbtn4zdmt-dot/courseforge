import "server-only";

import { section, userPrompt, type PromptPair } from "./shared";

export interface RelevanceItem {
  id: string;
  subtopic: string;
  title: string;
  snippet: string;
}

export interface RelevancePromptInput {
  topic: string;
  items: RelevanceItem[];
}

const SYSTEM = `You rate search results for CourseForge, which builds courses from web sources. For each result, rate how useful it is for teaching its subtopic to a learner.

Scale (0–1):
- 1.0: directly and substantially covers the subtopic; a good teaching source.
- 0.7: covers the subtopic, but partly or briefly.
- 0.4: related to the topic but not really about this subtopic.
- 0.1: off-topic, a product or sales page, a login wall, a list of links, or spam.

Rules:
- Judge only from the title and snippet given.
- Return exactly one score per result, using its id.

Output JSON shape:
{
  "scores": [{ "id": string, "relevance": number }]
}`;

export function buildRelevancePrompt(input: RelevancePromptInput): PromptPair {
  const results = input.items
    .map((i) => `id: ${i.id}\nsubtopic: ${i.subtopic}\ntitle: ${i.title}\nsnippet: ${i.snippet.slice(0, 500)}`)
    .join("\n\n");
  return {
    system: SYSTEM,
    prompt: userPrompt(section("Course topic", input.topic), section("Results", results)),
  };
}
