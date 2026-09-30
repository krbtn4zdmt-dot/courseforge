import { parseArgs } from "node:util";

export const LEVELS = ["beginner", "some_exposure", "refresher"] as const;
export type Level = (typeof LEVELS)[number];

export type GenCourseArgs = {
  topic: string;
  days: number;
  minutesPerDay: number;
  level: Level;
};

export type ParseResult =
  | { ok: true; args: GenCourseArgs }
  | { ok: false; error: string };

export const USAGE =
  'Usage: pnpm gen:course "<topic>" --days <1-60> --minutes <15-90> --level <beginner|some_exposure|refresher>';

function parseIntInRange(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
): number | string {
  if (raw === undefined) return `--${name} is required`;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return `--${name} must be a whole number from ${min} to ${max} (got "${raw}")`;
  }
  return value;
}

function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

export function parseGenCourseArgs(argv: string[]): ParseResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        days: { type: "string" },
        minutes: { type: "string" },
        level: { type: "string", default: "beginner" },
      },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const topic = parsed.positionals.join(" ").trim();
  if (topic === "") return { ok: false, error: "A topic is required" };

  const days = parseIntInRange(parsed.values.days, "days", 1, 60);
  if (typeof days === "string") return { ok: false, error: days };

  const minutesPerDay = parseIntInRange(parsed.values.minutes, "minutes", 15, 90);
  if (typeof minutesPerDay === "string") return { ok: false, error: minutesPerDay };

  const level = parsed.values.level;
  if (!isLevel(level)) {
    return { ok: false, error: `--level must be one of ${LEVELS.join(", ")} (got "${level}")` };
  }

  return { ok: true, args: { topic, days, minutesPerDay, level } };
}
