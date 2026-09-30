import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("@/ path alias", () => {
  it("resolves src imports in tests", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
