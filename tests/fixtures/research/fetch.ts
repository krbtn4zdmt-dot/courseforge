// Fake fetch for research client tests: routes by URL substring, records calls.
import { vi } from "vitest";

export type Route = {
  /** Substring the request URL must contain. */
  match: string;
  status?: number;
  body?: unknown;
  /** Throw this instead of responding (e.g. a TimeoutError). */
  error?: Error;
};

export function fakeFetch(routes: Route[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`fakeFetch: no route for ${url}`);
    if (route.error) throw route.error;
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body ?? null);
    return new Response(body, { status: route.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export function timeoutError(): Error {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}
