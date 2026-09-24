import { describe, expect, it, vi } from "vitest";

import { ResearchError } from "@/lib/research/http";
import { findWikipediaTitles, getWikipediaSummary, searchWikipedia, wikipediaUserAgent } from "@/lib/research/wikipedia";

import { jsonResponse, mockFetch } from "../../fixtures/research/mockFetch";
import summary from "../../fixtures/research/wikipedia.summary.json";

describe("wikipedia", () => {
  it("fetches a summary with a descriptive User-Agent", async () => {
    const fetch = mockFetch(() => jsonResponse(summary));
    const result = await getWikipediaSummary("Alexander the Great", { fetch, contactEmail: "team@example.com" });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Alexander_the_Great");
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("CourseForge/0.1 (team@example.com)");
    expect(result).toEqual({
      title: "Alexander the Great",
      url: "https://en.wikipedia.org/wiki/Alexander_the_Great",
      extract: expect.stringContaining("Macedon"),
      description: "King of Macedon from 336 to 323 BC",
    });
  });

  it("uses the requested language edition", async () => {
    const fetch = mockFetch(() => jsonResponse(summary));
    await getWikipediaSummary("Alexandre le Grand", { fetch, lang: "fr" });
    expect(String(fetch.mock.calls[0]![0])).toMatch(/^https:\/\/fr\.wikipedia\.org\//);
  });

  it("returns null for a missing page or a disambiguation page", async () => {
    expect(await getWikipediaSummary("Nope", { fetch: mockFetch(() => jsonResponse({ type: "not_found" }, 404)) })).toBeNull();
    const disambiguation = { ...summary, type: "disambiguation" };
    expect(await getWikipediaSummary("Mercury", { fetch: mockFetch(() => jsonResponse(disambiguation)) })).toBeNull();
  });

  it("retries a server error once, then throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = mockFetch(() => jsonResponse({}, 503));
    await expect(getWikipediaSummary("X", { fetch, retryDelayMs: 0 })).rejects.toBeInstanceOf(ResearchError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("searchWikipedia resolves a free-text query to a page, then summarizes it", async () => {
    const fetch = mockFetch(
      (url) =>
        url.pathname.endsWith("/search/page")
          ? jsonResponse({ pages: [{ key: "Alexander_the_Great", title: "Alexander the Great" }] })
          : undefined,
      (url) => (url.pathname.includes("/page/summary/") ? jsonResponse(summary) : undefined),
    );
    const result = await searchWikipedia("alexander macedon king", { fetch });
    expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.get("q")).toBe("alexander macedon king");
    expect(result?.title).toBe("Alexander the Great");
  });

  it("searchWikipedia returns null when nothing matches", async () => {
    const fetch = mockFetch(() => jsonResponse({ pages: [] }));
    expect(await searchWikipedia("zzzz", { fetch })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("findWikipediaTitles returns several titles, best first", async () => {
    const fetch = mockFetch(() => jsonResponse({ pages: [{ key: "A", title: "A" }, { key: "B", title: "B" }] }));
    expect(await findWikipediaTitles("q", { fetch, limit: 2 })).toEqual(["A", "B"]);
    expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.get("limit")).toBe("2");
  });

  it("user agent notes a missing contact", () => {
    expect(wikipediaUserAgent("")).toBe("CourseForge/0.1 (contact not configured)");
  });
});
