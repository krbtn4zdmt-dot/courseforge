// Shared HTTP helper for the research clients: timeouts, typed errors, Zod-validated JSON.
import type { z } from "zod";

export type FetchFn = typeof fetch;

export type ResearchProvider = "tavily" | "youtube" | "wikipedia";

export class ResearchError extends Error {
  readonly provider: ResearchProvider;
  /** HTTP status, when the server responded. */
  readonly status: number | null;
  /** Provider-specific reason, e.g. YouTube's "quotaExceeded". */
  readonly reason: string | null;
  readonly timedOut: boolean;

  constructor(
    provider: ResearchProvider,
    message: string,
    opts: { status?: number | null; reason?: string | null; timedOut?: boolean; cause?: unknown } = {},
  ) {
    super(`${provider}: ${message}`, { cause: opts.cause });
    this.name = "ResearchError";
    this.provider = provider;
    this.status = opts.status ?? null;
    this.reason = opts.reason ?? null;
    this.timedOut = opts.timedOut ?? false;
  }
}

export type FetchJsonOptions<T> = {
  provider: ResearchProvider;
  fetch: FetchFn;
  timeoutMs: number;
  schema: z.ZodType<T>;
  init?: RequestInit;
  /** Extracts a provider-specific error reason from a non-2xx JSON body. */
  errorReason?: (body: unknown) => string | null;
  /** Statuses that mean "not found" and return null instead of throwing. */
  nullOnStatus?: readonly number[];
};

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON error pages (e.g. rate-limit HTML) are reported as text.
    return text;
  }
}

/** GET/POST a JSON endpoint and validate the response. Throws ResearchError on any failure. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions<T>): Promise<T | null> {
  const { provider } = opts;
  let res: Response;
  try {
    res = await opts.fetch(url, { ...opts.init, signal: AbortSignal.timeout(opts.timeoutMs) });
  } catch (err) {
    if (isTimeout(err)) {
      throw new ResearchError(provider, `request timed out after ${opts.timeoutMs}ms`, { timedOut: true, cause: err });
    }
    throw new ResearchError(provider, `request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  if (opts.nullOnStatus?.includes(res.status)) return null;

  const body = await readBody(res);
  if (!res.ok) {
    const reason = opts.errorReason?.(body) ?? null;
    const detail = typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body)?.slice(0, 200);
    throw new ResearchError(provider, `HTTP ${res.status}${reason ? ` (${reason})` : ""}: ${detail}`, {
      status: res.status,
      reason,
    });
  }

  const parsed = opts.schema.safeParse(body);
  if (!parsed.success) {
    throw new ResearchError(provider, `unexpected response shape: ${parsed.error.message.slice(0, 300)}`, {
      status: res.status,
    });
  }
  return parsed.data;
}
