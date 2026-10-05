import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { sendMessage, type Effort } from "../client";
import { AiError } from "../errors";

/**
 * Step 1 of a "research on the web" feature (What others say): Claude searches the web with
 * Anthropic's server-side web search tool, reads a few pages in full with the web fetch tool,
 * and answers with cited text. This module runs that turn and hands back what was said, the
 * search results, and the text of every page read; the feature decides what to ask and how to
 * check the answer.
 *
 * Both tools are the basic versions, called directly. The newer versions filter results with
 * a code-execution step first, which was slow and could leave no quotes for the score check.
 */

/** Most web searches one research request may run. */
export const MAX_SEARCHES = 5;
/** Most pages one research request may read in full. */
export const MAX_FETCHES = 4;
/** About how much of each page Claude reads (tokens), so a long page stays cheap and quick. */
export const PAGE_TOKEN_LIMIT = 10_000;
/** Most times a paused research turn (`pause_turn`) is resumed. */
export const MAX_RESUMES = 3;

/** True only for an absolute http(s) URL; anything else is never stored or shown as a link. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export interface ResearchCitation {
  url: string;
  title: string | null;
  citedText: string;
}

export interface ResearchPassage {
  text: string;
  citations: ResearchCitation[];
}

/** A page Claude read in full with the web fetch tool. */
export interface ResearchPage {
  url: string;
  title: string | null;
  text: string;
}

export interface WebResearch {
  /** Claude's answer, block by block, with the citations of each block. */
  passages: ResearchPassage[];
  /** Every search result the tool returned. */
  results: { url: string; title: string }[];
  /** Every page read in full (text pages only; PDFs are skipped). */
  pages: ResearchPage[];
  /** Error codes of every search that returned an error (for example "max_uses_exceeded"). */
  searchErrors: string[];
  /** Searches that returned a result list (even an empty one), across every resumed turn. */
  searchesSucceeded: number;
  /** Searches that returned an error, not counting `max_uses_exceeded`. */
  searchesFailed: number;
  /** The model that served the research. */
  model: string;
}

/** The search tool's error code for a search past `max_uses`: the limit working, not a failure. */
const MAX_USES_EXCEEDED = "max_uses_exceeded";

/** The basic web search tool, called directly (no filtering code). No domain list means the whole web. */
export function webSearchTool(
  maxUses: number = MAX_SEARCHES,
  allowedDomains?: readonly string[],
): BetaToolUnion {
  return {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: maxUses,
    ...(allowedDomains ? { allowed_domains: [...allowedDomains] } : {}),
  };
}

/** The basic web fetch tool: reads a page from the search results in full. */
export function webFetchTool(maxUses: number = MAX_FETCHES): BetaToolUnion {
  return {
    type: "web_fetch_20250910",
    name: "web_fetch",
    max_uses: maxUses,
    max_content_tokens: PAGE_TOKEN_LIMIT,
  };
}

function collect(blocks: BetaContentBlock[], research: WebResearch): void {
  for (const block of blocks) {
    if (block.type === "text") {
      const citations: ResearchCitation[] = [];
      for (const citation of block.citations ?? []) {
        if (citation.type !== "web_search_result_location") continue;
        citations.push({
          url: citation.url,
          title: citation.title,
          citedText: citation.cited_text,
        });
      }
      research.passages.push({ text: block.text, citations });
    } else if (block.type === "web_search_tool_result") {
      // A failed search returns an error object instead of a list; it does not throw.
      if (Array.isArray(block.content)) {
        research.searchesSucceeded += 1;
        for (const result of block.content) {
          research.results.push({ url: result.url, title: result.title });
        }
      } else {
        const code = block.content.error_code;
        research.searchErrors.push(code);
        if (code !== MAX_USES_EXCEEDED) research.searchesFailed += 1;
      }
    } else if (block.type === "web_fetch_tool_result") {
      // A page that could not be read is an error object; Claude carries on without it.
      const fetched = block.content;
      if (fetched.type === "web_fetch_result" && fetched.content.source.type === "text") {
        research.pages.push({
          url: fetched.url,
          title: fetched.content.title,
          text: fetched.content.source.data,
        });
      }
    }
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AiError("aborted");
}

export interface WebResearchRequest {
  /** Feature name for usage totals, as in `AiRequest.feature`. */
  feature: string;
  system: string;
  /** The first user message. */
  content: string;
  /** Only these sites; leave it out to search the whole web. */
  allowedDomains?: readonly string[];
  /** Most searches the turn may run (default MAX_SEARCHES). */
  maxSearches?: number;
  /** Most pages the turn may read in full (default MAX_FETCHES; 0 turns reading off). */
  maxFetches?: number;
  /** How hard Claude thinks; research uses "low" so it answers quickly. */
  effort?: Effort;
  signal?: AbortSignal;
}

/**
 * Runs one research turn. A turn the server pauses (`pause_turn`) is resumed by sending its
 * content back as it is, up to MAX_RESUMES times; after that, whatever was found so far is
 * used. Throws AiError.
 */
export async function runWebResearch(request: WebResearchRequest): Promise<WebResearch> {
  const { feature, system, content, allowedDomains, maxSearches, signal } = request;
  const maxFetches = request.maxFetches ?? MAX_FETCHES;
  const tools = [webSearchTool(maxSearches, allowedDomains)];
  if (maxFetches > 0) tools.push(webFetchTool(maxFetches));
  const messages: BetaMessageParam[] = [{ role: "user", content }];
  const research: WebResearch = {
    passages: [],
    results: [],
    pages: [],
    searchErrors: [],
    searchesSucceeded: 0,
    searchesFailed: 0,
    model: "",
  };

  for (let resumes = 0; ; resumes += 1) {
    throwIfAborted(signal);
    const message = await sendMessage(
      { feature, system, messages, tools, effort: request.effort },
      { signal },
    );
    research.model = message.model;
    if (message.stop_reason === "refusal") throw new AiError("refusal");
    if (message.stop_reason === "max_tokens") throw new AiError("max-tokens");
    collect(message.content, research);
    if (message.stop_reason !== "pause_turn" || resumes >= MAX_RESUMES) break;
    // Resume: the assistant turn goes back as it is, with no extra user message.
    messages.push({ role: "assistant", content: message.content as BetaMessageParam["content"] });
  }
  return research;
}

/** How long a whole research feature (searches, reading, and summary) may take. */
export const RESEARCH_TIME_LIMIT_MS = 120_000;

/**
 * Runs `work` with a signal that aborts when `outer` aborts or when `limitMs` has passed. When
 * the time runs out (and the collector did not cancel), it throws AiError "timeout" with
 * `message`, so the collector never waits on a stuck search. The timer is always cleared.
 */
export async function withTimeLimit<T>(
  limitMs: number,
  outer: AbortSignal | undefined,
  message: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limitMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (timedOut && !outer?.aborted) throw new AiError("timeout", { message, cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

/** A page the research found, numbered for the summary, with the text cited from it. */
export interface NumberedSource {
  id: number;
  url: string;
  title: string;
  /** Every `cited_text` Claude quoted from this page. */
  quotes: string[];
  /** The page's full text when Claude read it with web fetch, else "". */
  pageText: string;
}

/**
 * Numbers every http(s) page that appeared in a citation, a page read, or a search result,
 * once each, in that order.
 */
export function numberSources(
  research: Pick<WebResearch, "passages" | "results"> & Partial<Pick<WebResearch, "pages">>,
): NumberedSource[] {
  const byUrl = new Map<string, NumberedSource>();
  const add = (url: string, title: string | null) => {
    if (!isHttpUrl(url)) return undefined;
    let source = byUrl.get(url);
    if (!source) {
      source = { id: byUrl.size + 1, url, title: "", quotes: [], pageText: "" };
      byUrl.set(url, source);
    }
    if (!source.title && title?.trim()) source.title = title.trim();
    return source;
  };
  for (const passage of research.passages) {
    for (const citation of passage.citations) {
      const source = add(citation.url, citation.title);
      if (source && citation.citedText.trim()) source.quotes.push(citation.citedText);
    }
  }
  for (const page of research.pages ?? []) {
    const source = add(page.url, page.title);
    if (source && page.text.trim()) {
      source.pageText = source.pageText ? `${source.pageText}\n${page.text}` : page.text;
    }
  }
  for (const result of research.results) add(result.url, result.title);
  for (const source of byUrl.values()) {
    if (!source.title) source.title = new URL(source.url).hostname.replace(/^www\./, "");
  }
  return [...byUrl.values()];
}

/** JSON for a prompt fence: "<" is escaped (valid JSON), so the data can never close the fence. */
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** Runs of whitespace as one space, trimmed: how quotes and labels are compared. */
export const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

/** The research passages with the ids of the numbered sources each one cites (empty passages dropped). */
export function passagesWithSourceIds(
  research: Pick<WebResearch, "passages">,
  sources: NumberedSource[],
): { text: string; sourceIds: number[] }[] {
  const ids = new Map(sources.map((source) => [source.url, source.id]));
  return research.passages
    .filter((passage) => passage.text.trim())
    .map((passage) => ({
      text: passage.text,
      sourceIds: [
        ...new Set(passage.citations.flatMap((c) => (ids.has(c.url) ? [ids.get(c.url)!] : []))),
      ],
    }));
}
