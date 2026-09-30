// Key-value cache with TTL for research results. Phase 1 uses JSON files under .cache/;
// Phase 2 can swap in a database-backed implementation of the same interface.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Cache = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
};

type Entry = { expiresAt: number; value: unknown };

export function createMemoryCache(now: () => number = Date.now): Cache {
  const entries = new Map<string, Entry>();
  return {
    async get<T>(key: string) {
      const entry = entries.get(key);
      if (!entry || entry.expiresAt <= now()) return null;
      return entry.value as T;
    },
    async set<T>(key: string, value: T, ttlMs: number) {
      entries.set(key, { expiresAt: now() + ttlMs, value });
    },
  };
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

export function createFileCache(dir: string, now: () => number = Date.now): Cache {
  const fileFor = (key: string) => path.join(dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  return {
    async get<T>(key: string) {
      let text: string;
      try {
        text = await readFile(fileFor(key), "utf8");
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      let entry: Entry;
      try {
        entry = JSON.parse(text) as Entry;
      } catch (err) {
        console.warn(`cache: ignoring corrupt entry for "${key}": ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
      if (entry.expiresAt <= now()) return null;
      return entry.value as T;
    },
    async set<T>(key: string, value: T, ttlMs: number) {
      await mkdir(dir, { recursive: true });
      const entry: Entry = { expiresAt: now() + ttlMs, value };
      await writeFile(fileFor(key), JSON.stringify(entry), "utf8");
    },
  };
}
