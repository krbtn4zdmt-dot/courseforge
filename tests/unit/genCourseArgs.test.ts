import { describe, expect, it } from "vitest";

import { parseGenCourseArgs } from "../../scripts/genCourseArgs";

describe("parseGenCourseArgs", () => {
  it("parses a full command", () => {
    const result = parseGenCourseArgs([
      "Alexander the Great",
      "--days",
      "3",
      "--minutes",
      "30",
      "--level",
      "beginner",
    ]);
    expect(result).toEqual({
      ok: true,
      args: { topic: "Alexander the Great", days: 3, minutesPerDay: 30, level: "beginner" },
    });
  });

  it("defaults level to beginner", () => {
    const result = parseGenCourseArgs(["Excel", "--days", "7", "--minutes", "30"]);
    expect(result.ok && result.args.level).toBe("beginner");
  });

  it("requires a topic", () => {
    expect(parseGenCourseArgs(["--days", "3", "--minutes", "30"])).toEqual({
      ok: false,
      error: "A topic is required",
    });
  });

  it.each([
    [["X", "--minutes", "30"], "--days is required"],
    [["X", "--days", "0", "--minutes", "30"], "--days must be a whole number from 1 to 60"],
    [["X", "--days", "61", "--minutes", "30"], "--days must be a whole number from 1 to 60"],
    [["X", "--days", "2.5", "--minutes", "30"], "--days must be a whole number from 1 to 60"],
    [["X", "--days", "3", "--minutes", "14"], "--minutes must be a whole number from 15 to 90"],
    [["X", "--days", "3", "--minutes", "91"], "--minutes must be a whole number from 15 to 90"],
    [["X", "--days", "3", "--minutes", "30", "--level", "expert"], "--level must be one of"],
  ])("rejects %j", (argv, message) => {
    const result = parseGenCourseArgs(argv);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
  });

  it("rejects unknown flags", () => {
    const result = parseGenCourseArgs(["X", "--days", "3", "--minutes", "30", "--bogus"]);
    expect(result.ok).toBe(false);
  });
});
