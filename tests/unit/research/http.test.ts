import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fetchJson, ResearchError } from "@/lib/research/http";

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

  it("returns null for statuses listed in nullOn", async () => {
    const fetch = mockFetch(() => jsonResponse({}, 404));
    expect(await fetchJson({ service: "wikipedia", url: "https://x.test/", schema, timeoutMs: 1_000, fetch, nullOn: [404] })).toBeNull();
  });
});
