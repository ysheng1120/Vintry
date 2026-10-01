import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getSelectedModel, sendMessage } from "../client";
import { AiError } from "../errors";

/**
 * Step 1 of every "research on the web" feature (critics, prices): Claude searches a fixed list
 * of sites with Anthropic's server-side web search tool and answers with cited text. This module
 * runs that turn and hands back what was said and what the tool returned; each feature decides
 * what to ask, which sites to allow, and how to check the answer.
 */

/** Most web searches one research request may run. */
export const MAX_SEARCHES = 5;
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

export interface WebResearch {
  /** Claude's answer, block by block, with the citations of each block. */
  passages: ResearchPassage[];
  /** Every search result the tool returned. */
  results: { url: string; title: string }[];
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

/** The web search tool, in the newest version the chosen model supports. */
export function webSearchTool(
  modelId: string,
  allowedDomains: readonly string[],
  maxUses: number = MAX_SEARCHES,
): BetaToolUnion {
  const settings = {
    name: "web_search" as const,
    max_uses: maxUses,
    allowed_domains: [...allowedDomains],
  };
  // Dynamic filtering (web_search_20260209) needs Opus/Sonnet 4.6 or later.
  return modelId === "claude-haiku-4-5"
    ? { type: "web_search_20250305", ...settings }
    : { type: "web_search_20260209", ...settings };
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
  /** The only sites the search may use; the tool matches subdomains too. */
  allowedDomains: readonly string[];
  /** Most searches the turn may run (default MAX_SEARCHES). */
  maxSearches?: number;
  signal?: AbortSignal;
}

/**
 * Runs one research turn. A turn the server pauses (`pause_turn`) is resumed by sending its
 * content back as it is, up to MAX_RESUMES times; after that, whatever was found so far is
 * used. Throws AiError.
 */
export async function runWebResearch(request: WebResearchRequest): Promise<WebResearch> {
  const { feature, system, content, allowedDomains, maxSearches, signal } = request;
  const model = await getSelectedModel();
  const tools = [webSearchTool(model.id, allowedDomains, maxSearches)];
  const messages: BetaMessageParam[] = [{ role: "user", content }];
  const research: WebResearch = {
    passages: [],
    results: [],
    searchErrors: [],
    searchesSucceeded: 0,
    searchesFailed: 0,
    model: "",
  };

  for (let resumes = 0; ; resumes += 1) {
    throwIfAborted(signal);
    const message = await sendMessage({ feature, system, messages, tools }, { signal });
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

/** A page the research found, numbered for the summary, with the text cited from it. */
export interface NumberedSource {
  id: number;
  url: string;
  title: string;
  /** Every `cited_text` Claude quoted from this page. */
  quotes: string[];
}

/** Numbers every http(s) page that appeared in a citation or a search result, once each. */
export function numberSources(
  research: Pick<WebResearch, "passages" | "results">,
): NumberedSource[] {
  const byUrl = new Map<string, NumberedSource>();
  const add = (url: string, title: string | null) => {
    if (!isHttpUrl(url)) return undefined;
    let source = byUrl.get(url);
    if (!source) {
      source = { id: byUrl.size + 1, url, title: "", quotes: [] };
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
  for (const result of research.results) add(result.url, result.title);
  for (const source of byUrl.values()) {
    if (!source.title) source.title = new URL(source.url).hostname.replace(/^www\./, "");
  }
  return [...byUrl.values()];
}
