import { describe, expect, it } from "vitest";

import { ResearchError } from "@/lib/research/http";
import { createWikipediaClient, WIKIPEDIA_USER_AGENT } from "@/lib/research/wikipedia";

import { fakeFetch, timeoutError } from "../../fixtures/research/fetch";
import search from "../../fixtures/research/wikipedia.search.json";
import summary from "../../fixtures/research/wikipedia.summary.json";

describe("wikipedia client", () => {
  it("searches pages", async () => {
    const { fetch, calls } = fakeFetch([{ match: "/w/rest.php/v1/search/page", body: search }]);
    const pages = await createWikipediaClient({ fetch }).search("Battle of Gaugamela", 2);
    expect(pages).toEqual([
      { title: "Battle of Gaugamela", key: "Battle_of_Gaugamela", description: "331 BC battle" },
      { title: "Gaugamela", key: "Gaugamela", description: null },
    ]);
    expect(calls[0]!.url).toBe("https://en.wikipedia.org/w/rest.php/v1/search/page?q=Battle%20of%20Gaugamela&limit=2");
  });

  it("sends the descriptive User-Agent Wikimedia requires", async () => {
    const { fetch, calls } = fakeFetch([{ match: "/page/summary/", body: summary }]);
    await createWikipediaClient({ fetch }).summary("Battle of Gaugamela");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(WIKIPEDIA_USER_AGENT);
    expect(WIKIPEDIA_USER_AGENT).toMatch(/https:\/\//);
  });

  it("fetches a summary by title", async () => {
    const { fetch, calls } = fakeFetch([{ match: "/page/summary/", body: summary }]);
    const result = await createWikipediaClient({ fetch }).summary("Battle of Gaugamela");
    expect(calls[0]!.url).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Battle_of_Gaugamela");
    expect(result).toEqual({
      title: "Battle of Gaugamela",
      url: "https://en.wikipedia.org/wiki/Battle_of_Gaugamela",
      description: "331 BC battle between Macedon and the Achaemenid Empire",
      extract: expect.stringContaining("331 BC"),
      timestamp: "2026-08-14T09:12:00Z",
      isDisambiguation: false,
    });
  });

  it("flags disambiguation pages and uses the language subdomain", async () => {
    const { fetch, calls } = fakeFetch([{ match: "/page/summary/", body: { ...summary, type: "disambiguation" } }]);
    const result = await createWikipediaClient({ fetch, lang: "fr" }).summary("Mercure");
    expect(result?.isDisambiguation).toBe(true);
    expect(calls[0]!.url).toContain("https://fr.wikipedia.org/");
  });

  it("returns null for a missing article", async () => {
    const { fetch } = fakeFetch([{ match: "/page/summary/", status: 404, body: { type: "not_found" } }]);
    expect(await createWikipediaClient({ fetch }).summary("No Such Page Xyz")).toBeNull();
  });

  it("throws on rate limiting (HTML body) and on timeouts", async () => {
    const limited = fakeFetch([{ match: "/page/summary/", status: 429, body: "You are making too many requests" }]);
    const error = await createWikipediaClient({ fetch: limited.fetch }).summary("X").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResearchError);
    expect(error).toMatchObject({ provider: "wikipedia", status: 429 });
    expect((error as Error).message).toContain("too many requests");

    const slow = fakeFetch([{ match: "/w/rest.php", error: timeoutError() }]);
    await expect(createWikipediaClient({ fetch: slow.fetch }).search("X")).rejects.toMatchObject({ timedOut: true });
  });
});
