import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fetchJson, isTransient, ResearchError } from "@/lib/research/http";

import { jsonResponse, mockFetch } from "../../fixtures/research/mockFetch";

const schema = z.object({ ok: z.boolean() });

describe("fetchJson", () => {
  it("returns validated JSON", async () => {
    const fetch = mockFetch(() => jsonResponse({ ok: true, extra: 1 }));
    expect(await fetchJson({ service: "tavily", url: "https://x.test/", schema, timeoutMs: 1_000, fetch })).toEqual({ ok: true });
  });

  it("times out with a ResearchError", async () => {
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const err = await fetchJson({ service: "wikipedia", url: "https://x.test/", schema, timeoutMs: 20, fetch: hang }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ResearchError);
    expect((err as Error).message).toBe("[wikipedia] timed out after 20ms");
  });

  it("wraps network failures", async () => {
    const fail = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchJson({ service: "youtube", url: "https://x.test/", schema, timeoutMs: 1_000, fetch: fail })).rejects.toThrow(
      "[youtube] request failed: fetch failed",
    );
  });

  it("keeps the status and parsed body on HTTP errors", async () => {
    const fetch = mockFetch(() => jsonResponse({ error: "nope" }, 500));
    const err = await fetchJson({ service: "tavily", url: "https://x.test/", schema, timeoutMs: 1_000, fetch }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, body: { error: "nope" } });
  });

  it("reports an egress-proxy denial clearly and doesn't retry it", async () => {
    const fetch = mockFetch(() => new Response("Host not in allowlist", { status: 403, headers: { "x-deny-reason": "host_not_allowed" } }));
    await expect(fetchJson({ service: "tavily", url: "https://api.tavily.com/search", schema, timeoutMs: 1_000, fetch, retries: 2 })).rejects.toThrow(
      "[tavily] blocked by the network policy (host_not_allowed): allow api.tavily.com",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null for statuses listed in nullOn", async () => {
    const fetch = mockFetch(() => jsonResponse({}, 404));
    expect(await fetchJson({ service: "wikipedia", url: "https://x.test/", schema, timeoutMs: 1_000, fetch, nullOn: [404] })).toBeNull();
  });

  describe("retries", () => {
    const base = { service: "tavily" as const, url: "https://x.test/", schema, timeoutMs: 1_000, retryDelayMs: 0 };

    it("retries transient failures and succeeds", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let n = 0;
      const fetch = mockFetch(() => (n++ === 0 ? jsonResponse({}, 502) : jsonResponse({ ok: true })));
      expect(await fetchJson({ ...base, fetch, retries: 1 })).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry client errors or bad shapes", async () => {
      const fetch = mockFetch(() => jsonResponse({ error: "bad key" }, 401));
      await expect(fetchJson({ ...base, fetch, retries: 3 })).rejects.toMatchObject({ status: 401 });
      expect(fetch).toHaveBeenCalledTimes(1);
      const shape = mockFetch(() => jsonResponse({ nope: 1 }));
      await expect(fetchJson({ ...base, fetch: shape, retries: 3 })).rejects.toThrow(/unexpected response shape/);
      expect(shape).toHaveBeenCalledTimes(1);
    });

    it("does not retry by default", async () => {
      const fetch = mockFetch(() => jsonResponse({}, 500));
      await expect(fetchJson({ ...base, fetch })).rejects.toMatchObject({ status: 500 });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("isTransient", () => {
      expect(isTransient(new ResearchError("tavily", "timed out"))).toBe(true);
      expect(isTransient(new ResearchError("tavily", "x", 429))).toBe(true);
      expect(isTransient(new ResearchError("tavily", "x", 503))).toBe(true);
      expect(isTransient(new ResearchError("tavily", "x", 404))).toBe(false);
      expect(isTransient(new Error("x"))).toBe(false);
    });
  });
});
