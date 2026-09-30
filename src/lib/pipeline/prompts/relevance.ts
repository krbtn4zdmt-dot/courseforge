import { joinSections, section, systemPrompt, type PromptPair } from "./shared";

export type RelevanceItem = {
  /** Unique within the batch; echoed back in the ratings. */
  id: string;
  subtopic: string;
  title: string;
  excerpt: string;
};

export type RelevancePromptInput = { items: readonly RelevanceItem[] };

export const EXCERPT_CHARS = 400;

const ROLE =
  "You are the source rater for CourseForge's researcher. For each search result, rate how useful it is for teaching its subtopic.";

const RULES = [
  "Rate each item from 0 to 1: 1 = directly and substantially about the subtopic; 0.5 = related but mostly about something else, or shallow; 0 = off-topic, spam, or a listing/navigation page.",
  "Judge only from the title and excerpt. Don't reward popularity or penalize a site for being unfamiliar.",
  "Return exactly one rating per item, using its id, and no other ids.",
];

const OUTPUT_SHAPE = `{
  "ratings": { "id": string, "relevance": number }[]   // relevance 0–1, one per item
}`;

export const RELEVANCE_SYSTEM = systemPrompt(ROLE, RULES, OUTPUT_SHAPE);

export function relevancePrompt({ items }: RelevancePromptInput): PromptPair {
  const body = items
    .map((item) => {
      const excerpt = item.excerpt.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
      return `id: ${item.id}\nsubtopic: ${item.subtopic}\ntitle: ${item.title}\nexcerpt: ${excerpt}`;
    })
    .join("\n\n");
  return { system: RELEVANCE_SYSTEM, prompt: joinSections(section("Items", body)) };
}
