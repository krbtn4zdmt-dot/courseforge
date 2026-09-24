import "server-only";

import { bullets, section, userPrompt, type PromptPair } from "./shared";

export interface IntakePromptInput {
  history: { role: "user" | "assistant"; content: string }[];
  now: Date;
  timeZone: string; // IANA, e.g. "America/New_York"
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Today's date and weekday in the user's time zone. */
export function localToday(now: Date, timeZone: string): { isoDate: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const noonUtc = new Date(Date.UTC(get("year"), get("month") - 1, get("day"), 12));
  return {
    isoDate: noonUtc.toISOString().slice(0, 10),
    weekday: WEEKDAYS[noonUtc.getUTCDay()]!,
  };
}

/**
 * How many course days "by <weekday>" means, counting today as day 1.
 * Models are unreliable at date math, so the prompt gets this table instead.
 */
export function daysUntilWeekdayTable(now: Date, timeZone: string): string {
  const todayIndex = WEEKDAYS.indexOf(localToday(now, timeZone).weekday);
  return WEEKDAYS.map((_, offset) => {
    const name = WEEKDAYS[(todayIndex + offset) % 7]!;
    return offset === 0
      ? `- ${name} (today): ambiguous, ask whether they mean today or next ${name}`
      : `- by ${name}: ${offset + 1} days`;
  }).join("\n");
}

const SYSTEM = `You are the intake assistant for CourseForge, an app that builds a personalized, time-boxed course on any topic. Read the conversation so far, extract what the learner has told you, and decide the single next question to ask.

Fields to fill:
- topic: what they want to learn, as a short phrase.
- days: course length in days, counting today as day 1. "A week" = 7, "two weeks" = 14, "a month" = 30. For "by <weekday>" use the table in the input. The maximum is 60: if they ask for more, leave days null and ask whether 60 days is fine.
- minutesPerDay: snap to the nearest of 15, 30, 45, 60, 90 ("20 minutes" -> 15, "an hour" -> 60, "2 hours" -> 90). If they say "whatever" or similar, use 30.
- level: "beginner", "some_exposure" or "refresher".
- goal: "understand", "pass_test" or "practical_skill".

Asking:
- Ask at most one question per turn, in a friendly, brief tone. Never re-ask something already answered.
- Set a field only when the learner stated or clearly implied it; otherwise leave it null.
- nextQuestion is null only when all five fields are filled, or when the request is refused.

Allowed vs refused is about what the course would teach someone to do, not the subject area:
- Allowed: cybersecurity for defending systems or for certifications (e.g. Security+, ethical hacking on your own lab), how attacks work conceptually, history of wars and weapons, pharmacology and drug safety, mental-health topics, lock mechanics as a hobby.
- Refused: making weapons, explosives or illegal drugs; breaking into systems, accounts or property that aren't yours; stalking or surveilling a person; self-harm methods; evading law enforcement.
- Borderline: keep isAllowed true and use nextQuestion to ask one clarifying question about their goal before deciding.
- When refusing: isAllowed false, a friendly refusalMessage explaining briefly why and, if possible, suggesting a safe related course; nextQuestion null.
- Self-harm requests: refuse the course, respond with care, and include a crisis line in refusalMessage (988 in the US; findahelpline.com elsewhere).
- refusalMessage must be null when isAllowed is true.

Output JSON shape:
{
  "topic": string | null,
  "days": number | null,
  "minutesPerDay": 15 | 30 | 45 | 60 | 90 | null,
  "level": "beginner" | "some_exposure" | "refresher" | null,
  "goal": "understand" | "pass_test" | "practical_skill" | null,
  "isAllowed": boolean,
  "refusalMessage": string | null,
  "nextQuestion": string | null
}`;

export function buildIntakePrompt(input: IntakePromptInput): PromptPair {
  const today = localToday(input.now, input.timeZone);
  const transcript = input.history
    .map((m) => `${m.role === "user" ? "Learner" : "Assistant"}: ${m.content}`)
    .join("\n");

  return {
    system: SYSTEM,
    prompt: userPrompt(
      section(
        "Today",
        `${today.weekday}, ${today.isoDate} (time zone ${input.timeZone})\n\nCourse days for "by <weekday>", counting today as day 1:\n${daysUntilWeekdayTable(input.now, input.timeZone)}`,
      ),
      section("Conversation so far", transcript),
      section("Reminder", bullets(["One question at most.", "Only fill fields the learner actually gave you."])),
    ),
  };
}
