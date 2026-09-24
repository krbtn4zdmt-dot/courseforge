import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Small async key-value cache with per-entry expiry. */
export interface ResearchCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Lowercase, collapse whitespace: "  Excel  PivotTables " and "excel pivottables" share an entry. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createMemoryCache(now: () => number = Date.now): ResearchCache {
  const store = new Map<string, Entry<unknown>>();
  return {
    async get<T>(key: string) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value as T;
    },
    async set<T>(key: string, value: T, ttlMs: number) {
      store.set(key, { value, expiresAt: now() + ttlMs });
    },
  };
}

/** One JSON file per key under `dir` (default .cache/research). Shared across CLI runs in Phase 1. */
export function createFileCache(dir = path.join(process.cwd(), ".cache", "research")): ResearchCache {
  const fileFor = (key: string) => path.join(dir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  return {
    async get<T>(key: string) {
      let text: string;
      try {
        text = await readFile(fileFor(key), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
      const entry = JSON.parse(text) as Entry<T>;
      return entry.expiresAt > Date.now() ? entry.value : undefined;
    },
    async set<T>(key: string, value: T, ttlMs: number) {
      await mkdir(dir, { recursive: true });
      const entry: Entry<T> = { value, expiresAt: Date.now() + ttlMs };
      await writeFile(fileFor(key), JSON.stringify(entry));
    },
  };
}
