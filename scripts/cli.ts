// Shared CLI helpers for the pipeline scripts.
import { parseArgs, type ParseArgsConfig } from "node:util";

import { GOALS, LEVELS, MINUTES_PER_DAY_OPTIONS, type CompletedIntake } from "@/lib/pipeline/schemas";

export const INTAKE_OPTIONS = {
  days: { type: "string", default: "7" },
  minutes: { type: "string", default: "30" },
  level: { type: "string", default: "beginner" },
  goal: { type: "string", default: "understand" },
} as const satisfies ParseArgsConfig["options"];

function oneOf<const A extends readonly (string | number)[]>(name: string, value: string | number, allowed: A): A[number] {
  const match = allowed.find((a) => a === value);
  if (match === undefined) throw new Error(`--${name} must be one of ${allowed.join(", ")}; got ${value}`);
  return match;
}

export function intakeFromArgs(
  topic: string | undefined,
  values: { days: string; minutes: string; level: string; goal: string },
  usage: string,
): CompletedIntake {
  if (!topic) throw new Error(`Usage: ${usage}`);
  return {
    topic,
    days: Number(values.days),
    minutesPerDay: oneOf("minutes", Number(values.minutes), MINUTES_PER_DAY_OPTIONS),
    level: oneOf("level", values.level, LEVELS),
    goal: oneOf("goal", values.goal, GOALS),
  };
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export { parseArgs };
