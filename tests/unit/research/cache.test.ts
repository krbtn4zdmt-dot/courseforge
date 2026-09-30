import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFileCache, createMemoryCache } from "@/lib/research/cache";

describe.each([
  ["memory", async (now: () => number) => createMemoryCache(now)],
  ["file", async (now: () => number) => createFileCache(await mkdtemp(path.join(tmpdir(), "cf-cache-")), now)],
])("%s cache", (_name, make) => {
  it("stores values until they expire", async () => {
    let now = 1_000;
    const cache = await make(() => now);
    expect(await cache.get("k")).toBeNull();
    await cache.set("k", { a: 1 }, 500);
    expect(await cache.get("k")).toEqual({ a: 1 });
    now = 1_500;
    expect(await cache.get("k")).toBeNull();
  });
});

describe("file cache", () => {
  it("hashes keys into file names and ignores a corrupt entry with a warning", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cf-cache-"));
    const cache = createFileCache(dir);
    await cache.set("youtube:v1:en:some query/with slashes", [1, 2], 60_000);
    const [file] = await readdir(dir);
    expect(file).toMatch(/^[0-9a-f]{64}\.json$/);

    await writeFile(path.join(dir, file!), "{not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cache.get("youtube:v1:en:some query/with slashes")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("corrupt entry"));
    warn.mockRestore();
  });
});
