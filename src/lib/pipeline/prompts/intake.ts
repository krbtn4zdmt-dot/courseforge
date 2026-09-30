import { joinSections, section, systemPrompt, type PromptPair } from "./shared";

export type IntakeMessage = { role: "user" | "assistant"; content: string };

export type IntakePromptInput = {
  messages: readonly IntakeMessage[];
  /** Today's date in the user's time zone, YYYY-MM-DD. */
  today: string;
  /** IANA time zone, e.g. "America/New_York". */
  timeZone: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CALENDAR_DAYS = 8;

const ROLE =
  "You are the intake assistant for CourseForge, an app that builds a personalized, time-boxed course on any topic. Read the conversation, extract what the learner has told you so far, and decide the single next question to ask.";

const RULES = [
  "Extract topic, days, minutesPerDay, level and goal. Use null for anything the learner hasn't said yet. Never guess a value they didn't give, except the defaults below.",
  "Ask at most one question per turn (nextQuestion) and never re-ask something already answered. Set nextQuestion to null only when all five fields are filled, or when the request is refused.",
  "level is one of: beginner (new to it), some_exposure (knows the basics), refresher (learned it before). goal is one of: understand, pass_test, practical_skill.",
  'minutesPerDay snaps to the nearest of 15, 30, 45, 60, 90: "20 minutes" → 15, "an hour" → 60, "2 hours" → 90. If the learner says "whatever" or similar, use 30.',
  'days counts today as day 1. Use the calendar in the input to count: "by Friday" said on a Wednesday is 3 days (Wed, Thu, Fri). If the named day is today, ask which week they mean. "A week" = 7, "two weeks" = 14, "a month" = 30.',
  "The maximum is 60 days. If the learner asks for more, leave days null and ask whether 60 days is fine.",
  "Allowed vs refused depends on what the course would teach someone to do, not on the subject area.",
  "Allowed: cybersecurity for defending systems or for certifications (e.g. Security+, ethical hacking in your own lab), how attacks work conceptually, history of wars and weapons, pharmacology and drug safety, mental-health topics, lock mechanics as a hobby.",
  "Refused: making weapons, explosives or illegal drugs; breaking into systems, accounts or property that aren't yours; stalking or surveilling a person; self-harm methods; evading law enforcement. Set isAllowed to false and write a short, friendly refusalMessage.",
  "Borderline: keep isAllowed true and use nextQuestion to ask one clarifying question about the goal before deciding.",
  "Self-harm requests: refuse the course, respond with care in refusalMessage, and include a crisis line (988 in the US; findahelpline.com elsewhere).",
  "refusalMessage is null whenever isAllowed is true.",
  "Write nextQuestion and refusalMessage in a warm, brief, conversational tone.",
];

const OUTPUT_SHAPE = `{
  "topic": string | null,
  "days": number | null,              // 1–60, today counts as day 1
  "minutesPerDay": 15 | 30 | 45 | 60 | 90 | null,
  "level": "beginner" | "some_exposure" | "refresher" | null,
  "goal": "understand" | "pass_test" | "practical_skill" | null,
  "isAllowed": boolean,
  "refusalMessage": string | null,    // only when isAllowed is false
  "nextQuestion": string | null       // null when all fields are filled or the request is refused
}`;

export const INTAKE_SYSTEM = systemPrompt(ROLE, RULES, OUTPUT_SHAPE);

function parseDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new RangeError(`today must be a valid YYYY-MM-DD date (got "${iso}")`);
  }
  return date;
}

/** "Day 1 = Wednesday 2026-09-30 (today)", one line per day, for counting "by Friday". */
export function dayCountCalendar(today: string, count = CALENDAR_DAYS): string {
  const start = parseDate(today);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start.getTime() + i * 86_400_000);
    const label = `Day ${i + 1} = ${WEEKDAYS[date.getUTCDay()]} ${date.toISOString().slice(0, 10)}`;
    return i === 0 ? `${label} (today)` : label;
  }).join("\n");
}

export function intakePrompt(input: IntakePromptInput): PromptPair {
  const conversation = input.messages
    .map((m) => `${m.role === "user" ? "Learner" : "Assistant"}: ${m.content}`)
    .join("\n");
  return {
    system: INTAKE_SYSTEM,
    prompt: joinSections(
      section("Today", `${input.today} (time zone: ${input.timeZone})`),
      section("Calendar for counting days", dayCountCalendar(input.today)),
      section("Conversation so far", conversation || "(no messages yet)"),
    ),
  };
}
