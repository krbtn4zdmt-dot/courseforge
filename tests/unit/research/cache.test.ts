import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFileCache, createMemoryCache, normalizeQuery } from "@/lib/research/cache";

describe("cache", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("normalizeQuery collapses case and whitespace", () => {
    expect(normalizeQuery("  Excel   PivotTables\n")).toBe("excel pivottables");
  });

  it("memory cache honors expiry", async () => {
    let now = 1_000;
    const cache = createMemoryCache(() => now);
    await cache.set("k", { a: 1 }, 500);
    expect(await cache.get("k")).toEqual({ a: 1 });
    now = 1_500;
    expect(await cache.get("k")).toBeUndefined();
  });

  it("file cache round-trips values and misses cleanly", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cf-cache-"));
    const cache = createFileCache(dir);
    expect(await cache.get("missing")).toBeUndefined();
    await cache.set("youtube:v1:en:excel", [{ videoId: "x" }], 60_000);
    expect(await createFileCache(dir).get("youtube:v1:en:excel")).toEqual([{ videoId: "x" }]);
    expect(await readdir(dir)).toHaveLength(1);
    await cache.set("expired", 1, -1);
    expect(await cache.get("expired")).toBeUndefined();
  });
});
