import { describe, expect, it, vi } from "vitest";

import { ResearchError } from "@/lib/research/http";
import { searchTavily } from "@/lib/research/tavily";

import { jsonResponse, mockFetch } from "../../fixtures/research/mockFetch";
import tavilySearch from "../../fixtures/research/tavily.search.json";

describe("searchTavily", () => {
  it("posts the query with auth and maps results", async () => {
    const fetch = mockFetch(() => jsonResponse(tavilySearch));
    const results = await searchTavily(
      { query: "Alexander the Great", depth: "advanced", includeRawContent: true },
      { apiKey: "tvly-test", fetch },
    );

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.tavily.com/search");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      query: "Alexander the Great",
      search_depth: "advanced",
      max_results: 5,
      include_raw_content: true,
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://www.britannica.com/biography/Alexander-the-Great",
      score: 0.91,
      rawContent: expect.stringContaining("Alexander III"),
      publishedDate: null,
    });
    expect(results[1]).toMatchObject({ rawContent: null, publishedDate: null });
  });

  it("does not ask for raw content by default", async () => {
    const fetch = mockFetch(() => jsonResponse({ results: [] }));
    await searchTavily({ query: "q", depth: "basic" }, { apiKey: "k", fetch });
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string).include_raw_content).toBe(false);
  });

  it("throws ResearchError with the status on HTTP errors", async () => {
    const fetch = mockFetch(() => jsonResponse({ detail: { error: "Unauthorized" } }, 401));
    const err = await searchTavily({ query: "q", depth: "basic" }, { apiKey: "bad", fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResearchError);
    expect(err).toMatchObject({ service: "tavily", status: 401 });
  });

  it("throws on an unexpected response shape", async () => {
    const fetch = mockFetch(() => jsonResponse({ answer: "no results key" }));
    await expect(searchTavily({ query: "q", depth: "basic" }, { apiKey: "k", fetch })).rejects.toThrow(
      /unexpected response shape/,
    );
  });

  it("passes a timeout signal to fetch", async () => {
    const fetch = mockFetch(() => jsonResponse({ results: [] }));
    await searchTavily({ query: "q", depth: "basic" }, { apiKey: "k", fetch });
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    await expect(searchTavily({ query: "q", depth: "basic" }, { fetch: mockFetch() })).rejects.toThrow(
      "TAVILY_API_KEY is not set",
    );
    vi.unstubAllEnvs();
  });
});
