import { describe, expect, it } from "vitest";

import { ResearchError } from "@/lib/research/http";
import { createTavilyClient, TAVILY_URL } from "@/lib/research/tavily";

import { fakeFetch, timeoutError } from "../../fixtures/research/fetch";
import search from "../../fixtures/research/tavily.search.json";

describe("tavily client", () => {
  it("parses results and maps fields", async () => {
    const { fetch } = fakeFetch([{ match: TAVILY_URL, body: search }]);
    const results = await createTavilyClient({ apiKey: "k", fetch }).search("Battle of Gaugamela", { depth: "basic" });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      url: "https://en.wikipedia.org/wiki/Battle_of_Gaugamela",
      title: "Battle of Gaugamela - Wikipedia",
      content: expect.stringContaining("331 BC"),
      rawContent: null,
      publishedDate: null,
      tavilyScore: 0.97,
    });
    expect(results[1]?.publishedDate).toBe("2023-05-02");
    expect(results[1]?.rawContent).toContain("Alexander's plan");
  });

  it("sends a bearer token and asks for raw content only in advanced mode", async () => {
    const { fetch, calls } = fakeFetch([{ match: TAVILY_URL, body: search }]);
    const client = createTavilyClient({ apiKey: "secret", fetch });
    await client.search("q", { depth: "basic" });
    await client.search("q", { depth: "advanced", maxResults: 3 });

    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({
      query: "q",
      search_depth: "basic",
      max_results: 5,
      include_raw_content: false,
    });
    expect(JSON.parse(calls[1]!.init!.body as string)).toMatchObject({
      search_depth: "advanced",
      max_results: 3,
      include_raw_content: "text",
    });
    expect(calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a ResearchError with status and reason on HTTP errors", async () => {
    const { fetch } = fakeFetch([
      { match: TAVILY_URL, status: 401, body: { detail: { error: "Unauthorized: missing or invalid API key." } } },
    ]);
    const error = await createTavilyClient({ apiKey: "bad", fetch })
      .search("q", { depth: "basic" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResearchError);
    expect(error).toMatchObject({ provider: "tavily", status: 401, reason: "Unauthorized: missing or invalid API key." });
  });

  it("reports timeouts", async () => {
    const { fetch } = fakeFetch([{ match: TAVILY_URL, error: timeoutError() }]);
    const error = await createTavilyClient({ apiKey: "k", fetch })
      .search("q", { depth: "advanced" })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ provider: "tavily", timedOut: true });
    expect((error as Error).message).toContain("30000ms");
  });

  it("rejects an unexpected response shape", async () => {
    const { fetch } = fakeFetch([{ match: TAVILY_URL, body: { results: [{ url: 1 }] } }]);
    await expect(createTavilyClient({ apiKey: "k", fetch }).search("q", { depth: "basic" })).rejects.toThrow(
      /unexpected response shape/,
    );
  });
});
