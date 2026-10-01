import "server-only";

import { termsFrom, trimGrounding } from "@/lib/research/grounding";
import { canonicalUrl } from "@/lib/research/scoring";

import type { LessonSource } from "./prompts/lessonWriter";
import type { ResearcherOutput, Source } from "./schemas";

export const MAX_SOURCES_PER_LESSON = 6;
export const MAX_VIDEOS_PER_LESSON = 2;
/** All of a lesson's source text together (the Lesson Writer's and Fact-Checker's main input cost). */
export const MAX_LESSON_GROUNDING_WORDS = 4_500;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Shares a word budget across a lesson's sources: sources under their share keep everything and pass the
 * rest on; a longer source keeps its paragraphs that mention the lesson's subtopics most (trimGrounding).
 */
export function capLessonGrounding(sources: LessonSource[], subtopics: readonly string[], maxWords = MAX_LESSON_GROUNDING_WORDS): LessonSource[] {
  const counts = sources.map((s) => words(s.grounding));
  const allowed = new Array<number>(sources.length);
  let remaining = maxWords;
  const shortestFirst = counts.map((_, i) => i).sort((a, b) => counts[a]! - counts[b]!);
  shortestFirst.forEach((i, k) => {
    allowed[i] = Math.min(counts[i]!, Math.floor(remaining / (shortestFirst.length - k)));
    remaining -= allowed[i]!;
  });
  const terms = termsFrom(...subtopics);
  return sources.map((s, i) => (counts[i]! > allowed[i]! ? { ...s, grounding: trimGrounding(s.grounding, terms, allowed[i]) } : s));
}

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
 * Non-video sources for a lesson's subtopics, grounded first (by score), then excerpt-only (by score),
 * with their text capped at maxWords in total. Position in the returned list is the citation number minus one.
 */
export function selectLessonSources(
  research: ResearcherOutput,
  subtopics: readonly string[],
  max = MAX_SOURCES_PER_LESSON,
  maxWords = MAX_LESSON_GROUNDING_WORDS,
): LessonSource[] {
  const text = sourcesFor(research, subtopics).filter((s) => s.type !== "video");
  const byScore = (a: Source, b: Source) => b.score - a.score;
  const grounded = text.filter((s) => s.grounding).sort(byScore);
  const excerptOnly = text.filter((s) => !s.grounding).sort(byScore);
  const selected = [...grounded, ...excerptOnly].slice(0, max).map((s) => ({
    title: s.title,
    url: s.url,
    grounding: s.grounding ?? s.excerpt,
    excerptOnly: !s.grounding,
  }));
  return capLessonGrounding(selected, subtopics, maxWords);
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
