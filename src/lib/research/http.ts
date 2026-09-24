import "server-only";

import type { z } from "zod";

export type Service = "tavily" | "youtube" | "wikipedia";
export type FetchFn = typeof fetch;

export class ResearchError extends Error {
  override name = "ResearchError";
  constructor(
    readonly service: Service,
    message: string,
    readonly status?: number,
    /** Parsed error body, when the API returned one. */
    readonly body?: unknown,
  ) {
    super(`[${service}] ${message}`);
  }
}

export interface FetchJsonOptions<T> {
  service: Service;
  url: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  init?: RequestInit;
  fetch?: FetchFn;
  /** Statuses that return null instead of throwing (e.g. 404 for "not found"). */
  nullOn?: number[];
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** GET/POST a JSON API with a timeout, typed errors and Zod-validated output. */
export async function fetchJson<T>(opts: FetchJsonOptions<T>): Promise<T | null> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url, { ...opts.init, signal: AbortSignal.timeout(opts.timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ResearchError(
      opts.service,
      timedOut ? `timed out after ${opts.timeoutMs}ms` : `request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (opts.nullOn?.includes(res.status)) return null;
  const body = await readBody(res);
  if (!res.ok) {
    throw new ResearchError(opts.service, `HTTP ${res.status}`, res.status, body);
  }

  const parsed = opts.schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ResearchError(opts.service, `unexpected response shape: ${issues}`, res.status);
  }
  return parsed.data;
}
