import { vi } from "vitest";

export type Route = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch mock that asks each route in turn; unmatched requests fail the test. */
export function mockFetch(...routes: Route[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    for (const route of routes) {
      const res = await route(url, init);
      if (res) return res;
    }
    throw new Error(`mockFetch: no route for ${url}`);
  });
}

// ---------- YouTube builders ----------

export interface FakeVideo {
  id: string;
  title?: string;
  channelId?: string;
  duration?: string; // ISO 8601
  views?: number;
}

export function searchBody(videos: FakeVideo[]) {
  return {
    kind: "youtube#searchListResponse",
    items: videos.map((v) => ({
      kind: "youtube#searchResult",
      id: { kind: "youtube#video", videoId: v.id },
      snippet: {
        title: v.title ?? `Video ${v.id}`,
        channelId: v.channelId ?? "chan1",
        channelTitle: "History Channel &amp; Co",
        publishedAt: "2023-05-01T00:00:00Z",
      },
    })),
  };
}

export function videosBody(videos: FakeVideo[]) {
  return {
    items: videos.map((v) => ({
      id: v.id,
      contentDetails: { duration: v.duration ?? "PT10M" },
      statistics: { viewCount: String(v.views ?? 100_000) },
    })),
  };
}

export function channelsBody(ids: string[], hidden: string[] = []) {
  return {
    items: ids.map((id) => ({
      id,
      statistics: hidden.includes(id) ? { hiddenSubscriberCount: true } : { subscriberCount: "250000", hiddenSubscriberCount: false },
    })),
  };
}
