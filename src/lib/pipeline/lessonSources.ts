import "server-only";

import { canonicalUrl } from "@/lib/research/scoring";

import type { LessonSource } from "./prompts/lessonWriter";
import type { ResearcherOutput, Source } from "./schemas";

export const MAX_SOURCES_PER_LESSON = 6;
export const MAX_VIDEOS_PER_LESSON = 2;

function sourcesFor(research: ResearcherOutput, subtopics: readonly string[]): Source[] {
  const wanted = new Set(subtopics);
  const seen = new Set<string>();
  return research
    .filter((r) => wanted.has(r.subtopic))
    .flatMap((r) => r.sources)
    .filter((s) => {
      const key = canonicalUrl(s.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Non-video sources for a lesson's subtopics, grounded first (by score), then excerpt-only (by score).
 * Position in the returned list is the citation number minus one.
 */
export function selectLessonSources(
  research: ResearcherOutput,
  subtopics: readonly string[],
  max = MAX_SOURCES_PER_LESSON,
): LessonSource[] {
  const text = sourcesFor(research, subtopics).filter((s) => s.type !== "video");
  const byScore = (a: Source, b: Source) => b.score - a.score;
  const grounded = text.filter((s) => s.grounding).sort(byScore);
  const excerptOnly = text.filter((s) => !s.grounding).sort(byScore);
  return [...grounded, ...excerptOnly].slice(0, max).map((s) => ({
    title: s.title,
    url: s.url,
    grounding: s.grounding ?? s.excerpt,
    excerptOnly: !s.grounding,
  }));
}

/** Top 0–2 videos for a lesson's subtopics. */
export function selectLessonVideos(
  research: ResearcherOutput,
  subtopics: readonly string[],
  max = MAX_VIDEOS_PER_LESSON,
): Source[] {
  return sourcesFor(research, subtopics)
    .filter((s) => s.type === "video")
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}
