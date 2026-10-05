import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/db";
import { resetDatabase } from "../../db/testing";
import { saveApiKey, setSelectedModel } from "../client";
import { AiError } from "../errors";
import {
  fakeCitedText,
  fakeWebFetch,
  fakeWebSearch,
  installFakeAi,
  uninstallFakeAi,
  type FakeAi,
} from "../fake";
import {
  isHttpUrl,
  MAX_FETCHES,
  MAX_RESUMES,
  MAX_SEARCHES,
  PAGE_TOKEN_LIMIT,
  numberSources,
  runWebResearch,
  withTimeLimit,
  type WebResearchRequest,
} from "./webResearch";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
  await saveApiKey("sk-ant-test");
});

afterEach(() => {
  uninstallFakeAi();
});

const SITE_A = "https://www.wine-searcher.com/find/ridge+monte+bello/2019";
const SITE_B = "https://www.klwines.com/p/i?i=1234567";
const DOMAINS = ["wine-searcher.com", "klwines.com"] as const;

const request = (overrides: Partial<WebResearchRequest> = {}): WebResearchRequest => ({
  feature: "critics",
  system: "You research one wine.",
  content: "Find it.",
  allowedDomains: DOMAINS,
  ...overrides,
});

/** One search that succeeded and an answer with two cited texts. */
function queueAnswer(stop_reason: "end_turn" | "pause_turn" = "end_turn") {
  ai.queueResponse({
    content: [
      ...fakeWebSearch("srv_1", "ridge monte bello 2019", [
        { url: SITE_A, title: "Ridge Monte Bello 2019 | Wine-Searcher" },
        { url: SITE_B, title: "Ridge Monte Bello 2019 | K&L" },
      ]),
      fakeCitedText("It lists at $250.", [
        { url: SITE_A, title: "Ridge Monte Bello 2019 | Wine-Searcher", citedText: "From $250" },
      ]),
      fakeCitedText(" K&L has it for $239.99.", [
        { url: SITE_B, title: "Ridge Monte Bello 2019 | K&L", citedText: "$239.99 in stock" },
      ]),
    ],
    stop_reason,
  });
}

describe("runWebResearch", () => {
  it("returns every cited text with its url, title and quote, and the search results", async () => {
    queueAnswer();
    const research = await runWebResearch(request());
    expect(research.passages).toHaveLength(2);
    expect(research.passages[0]).toEqual({
      text: "It lists at $250.",
      citations: [
        {
          url: SITE_A,
          title: "Ridge Monte Bello 2019 | Wine-Searcher",
          citedText: "From $250",
        },
      ],
    });
    expect(research.passages[1]?.citations).toEqual([
      { url: SITE_B, title: "Ridge Monte Bello 2019 | K&L", citedText: "$239.99 in stock" },
    ]);
    expect(research.results.map((r) => r.url)).toEqual([SITE_A, SITE_B]);
    expect(research.searchErrors).toEqual([]);
    expect(research.model).toBe("claude-opus-5");
  });

  it("sends the system prompt, the user content, the feature name, the allowed sites, and the basic direct tools", async () => {
    queueAnswer();
    await runWebResearch(request({ feature: "prices", content: "Price this." }));
    const sent = ai.requests[0]!;
    expect(sent.system).toBe("You research one wine.");
    expect(sent.messages).toEqual([{ role: "user", content: "Price this." }]);
    expect(sent.tools).toEqual([
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: MAX_SEARCHES,
        allowed_domains: [...DOMAINS],
      },
      {
        type: "web_fetch_20250910",
        name: "web_fetch",
        max_uses: MAX_FETCHES,
        max_content_tokens: PAGE_TOKEN_LIMIT,
      },
    ]);
    expect(sent.output_config?.format).toBeUndefined();
    expect((await db.aiUsage.toArray()).map((row) => row.feature)).toEqual(["prices"]);
  });

  it("passes a lower search limit through", async () => {
    queueAnswer();
    await runWebResearch(request({ maxSearches: 2 }));
    expect(ai.requests[0]?.tools?.[0]).toMatchObject({ max_uses: 2 });
  });

  it("uses the same basic tools on every model, with no filtering code", async () => {
    for (const model of ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"] as const) {
      await setSelectedModel(model);
      queueAnswer();
      await runWebResearch(request());
    }
    for (const sent of ai.requests) {
      expect(sent.tools?.map((tool) => tool.type)).toEqual([
        "web_search_20250305",
        "web_fetch_20250910",
      ]);
    }
  });

  it("searches the whole web when no sites are given, and can turn page reading off", async () => {
    queueAnswer();
    await runWebResearch(request({ allowedDomains: undefined, maxFetches: 0 }));
    expect(ai.requests[0]?.tools).toEqual([
      { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES },
    ]);
  });

  it("passes the effort through", async () => {
    queueAnswer();
    await runWebResearch(request({ effort: "low" }));
    expect(ai.requests[0]?.output_config?.effort).toBe("low");
  });

  it("keeps the text of every page read and skips pages that could not be read", async () => {
    ai.queueResponse({
      content: [
        ...fakeWebSearch("srv_1", "ridge", [{ url: SITE_A, title: "Wine-Searcher" }]),
        ...fakeWebFetch("srv_2", SITE_A, {
          title: "Ridge | Wine-Searcher",
          text: "Critics: 97/100",
        }),
        ...fakeWebFetch("srv_3", SITE_B, { errorCode: "url_not_accessible" }),
        fakeCitedText("Done.", []),
      ],
    });
    const research = await runWebResearch(request());
    expect(research.pages).toEqual([
      { url: SITE_A, title: "Ridge | Wine-Searcher", text: "Critics: 97/100" },
    ]);
    expect(research.searchesFailed).toBe(0);
    expect(numberSources(research)).toEqual([
      {
        id: 1,
        url: SITE_A,
        title: "Ridge | Wine-Searcher",
        quotes: [],
        pageText: "Critics: 97/100",
      },
    ]);
  });

  it("resumes a paused turn by sending the assistant content back as it is", async () => {
    const paused = [
      ...fakeWebSearch("srv_1", "ridge", [{ url: SITE_A, title: "Wine-Searcher" }]),
      { type: "server_tool_use", id: "srv_2", name: "web_search", input: { query: "more" } },
    ];
    ai.queueResponse({ content: paused as never, stop_reason: "pause_turn" });
    queueAnswer();

    const research = await runWebResearch(request());

    expect(ai.requests).toHaveLength(2);
    const resumed = ai.requests[1]!.messages;
    expect(resumed).toHaveLength(2);
    expect(resumed[0]).toEqual(ai.requests[0]!.messages[0]);
    expect(resumed[1]).toEqual({ role: "assistant", content: paused });
    expect(research.results.map((r) => r.url)).toEqual([SITE_A, SITE_A, SITE_B]);
    expect(research.passages).toHaveLength(2);
  });

  it(`stops resuming after ${MAX_RESUMES} pauses and keeps what it found`, async () => {
    for (let i = 0; i <= MAX_RESUMES; i += 1) queueAnswer("pause_turn");
    const research = await runWebResearch(request());
    expect(ai.requests).toHaveLength(MAX_RESUMES + 1);
    expect(ai.remaining()).toBe(0);
    expect(research.passages).toHaveLength(2 * (MAX_RESUMES + 1));
  });

  it("reports a search that returned an error object as an error, not a source", async () => {
    ai.queueResponse({
      content: [
        ...fakeWebSearch("srv_1", "ridge", { errorCode: "unavailable" }),
        fakeCitedText("Nothing.", []),
      ],
    });
    const research = await runWebResearch(request());
    expect(research.searchErrors).toEqual(["unavailable"]);
    expect(research.results).toEqual([]);
    expect(numberSources(research)).toEqual([]);
    expect(research.searchesSucceeded).toBe(0);
    expect(research.searchesFailed).toBe(1);
  });

  it("counts the searches that succeeded", async () => {
    queueAnswer();
    const research = await runWebResearch(request());
    expect(research.searchesSucceeded).toBe(1);
    expect(research.searchesFailed).toBe(0);
  });

  it("counts a search that returned no results as a success", async () => {
    ai.queueResponse({ content: [...fakeWebSearch("srv_1", "ridge", []), fakeCitedText("-", [])] });
    const research = await runWebResearch(request());
    expect(research.searchesSucceeded).toBe(1);
    expect(research.searchesFailed).toBe(0);
    expect(research.searchErrors).toEqual([]);
  });

  it("counts five successes and no failure when max_uses_exceeded follows five good searches", async () => {
    const searches = [1, 2, 3, 4, 5].flatMap((n) =>
      fakeWebSearch(`srv_${n}`, `query ${n}`, [{ url: SITE_A, title: "Wine-Searcher" }]),
    );
    ai.queueResponse({
      content: [
        ...searches,
        ...fakeWebSearch("srv_6", "query 6", { errorCode: "max_uses_exceeded" }),
        fakeCitedText("Done.", []),
      ],
    });
    const research = await runWebResearch(request());
    expect(research.searchesSucceeded).toBe(5);
    expect(research.searchesFailed).toBe(0);
    // The raw code is still listed for callers that want it.
    expect(research.searchErrors).toEqual(["max_uses_exceeded"]);
  });

  it("adds counts across resumed turns and counts real failures next to the limit", async () => {
    ai.queueResponse({
      content: [
        ...fakeWebSearch("srv_1", "a", [{ url: SITE_A, title: "Wine-Searcher" }]),
        ...fakeWebSearch("srv_2", "b", { errorCode: "too_many_requests" }),
      ],
      stop_reason: "pause_turn",
    });
    ai.queueResponse({
      content: [
        ...fakeWebSearch("srv_3", "c", [{ url: SITE_B, title: "K&L" }]),
        ...fakeWebSearch("srv_4", "d", { errorCode: "max_uses_exceeded" }),
        fakeCitedText("Done.", []),
      ],
    });
    const research = await runWebResearch(request());
    expect(research.searchesSucceeded).toBe(2);
    expect(research.searchesFailed).toBe(1);
    expect(research.searchErrors).toEqual(["too_many_requests", "max_uses_exceeded"]);
  });

  it("throws on a refusal and on max tokens", async () => {
    ai.queueResponse({ content: [], stop_reason: "refusal" });
    await expect(runWebResearch(request())).rejects.toMatchObject({ kind: "refusal" });
    ai.queueResponse({ content: [], stop_reason: "max_tokens" });
    await expect(runWebResearch(request())).rejects.toMatchObject({ kind: "max-tokens" });
  });

  it("does not send when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runWebResearch(request({ signal: controller.signal }))).rejects.toBeInstanceOf(
      AiError,
    );
    expect(ai.requests).toHaveLength(0);
  });
});

describe("withTimeLimit", () => {
  it("returns the result when the work ends in time", async () => {
    await expect(withTimeLimit(1_000, undefined, "Too slow.", async () => 42)).resolves.toBe(42);
  });

  it("aborts the work and throws a timeout with the message when time runs out", async () => {
    const work = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AiError("aborted")));
      });
    await expect(withTimeLimit(10, undefined, "Too slow.", work)).rejects.toMatchObject({
      kind: "timeout",
      message: "Too slow.",
    });
  });

  it("passes a cancel through as it is", async () => {
    const outer = new AbortController();
    const work = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AiError("aborted")));
      });
    const pending = withTimeLimit(10_000, outer.signal, "Too slow.", work);
    outer.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https and rejects everything else", () => {
    expect(isHttpUrl("https://www.klwines.com/x")).toBe(true);
    expect(isHttpUrl("http://klwines.com/x")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://klwines.com/x")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("numberSources", () => {
  it("numbers each http(s) page once with its quotes, citations first", () => {
    const sources = numberSources({
      passages: [
        {
          text: "x",
          citations: [
            { url: SITE_B, title: null, citedText: "$239.99" },
            { url: "javascript:alert(1)", title: "Bad", citedText: "$1" },
            { url: SITE_B, title: "K&L", citedText: "In stock" },
          ],
        },
      ],
      results: [
        { url: SITE_A, title: "Wine-Searcher" },
        { url: SITE_B, title: "Ignored" },
      ],
    });
    expect(sources).toEqual([
      { id: 1, url: SITE_B, title: "K&L", quotes: ["$239.99", "In stock"], pageText: "" },
      { id: 2, url: SITE_A, title: "Wine-Searcher", quotes: [], pageText: "" },
    ]);
  });
});
