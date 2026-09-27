import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getSelectedModel, sendMessage } from "../client";
import { AiError } from "../errors";

/**
 * The research step shared by "What critics say" and "Suggested price": Claude searches a fixed
 * list of sites with Anthropic's server-side web search tool and answers with cited text. The
 * features then number the pages found, ask for a structured summary in a second request
 * (structured outputs cannot be combined with citations), and check that summary against the
 * text really cited from each page.
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

/** JSON that cannot close the fence: "<" is escaped, which JSON allows. */
export const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** Collapses runs of whitespace to one space and trims. */
export const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AiError("aborted");
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
  /** Error codes of searches that failed (for example "max_uses_exceeded"). */
  searchErrors: string[];
  /** The model that served the research. */
  model: string;
}

/**
 * The web search tool, in the newest version the chosen model supports. The tool matches
 * subdomains too, so "decanter.com" also covers "www.decanter.com".
 */
function webSearchTool(modelId: string, domains: readonly string[]): BetaToolUnion {
  const settings = {
    name: "web_search" as const,
    max_uses: MAX_SEARCHES,
    allowed_domains: [...domains],
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
        for (const result of block.content) {
          research.results.push({ url: result.url, title: result.title });
        }
      } else {
        research.searchErrors.push(block.content.error_code);
      }
    }
  }
}

export interface WebResearchRequest {
  /** Feature name for usage totals, e.g. "critics". */
  feature: string;
  system: string;
  /** The user message: the question and the fenced wine data. */
  prompt: string;
  /** The only sites the search may use. */
  domains: readonly string[];
}

/**
 * Claude searches the given sites and answers with cited text. A turn the server pauses
 * (`pause_turn`) is resumed by sending its content back as it is, up to MAX_RESUMES times;
 * after that, whatever was found so far is used. Throws AiError.
 */
export async function runWebResearch(
  request: WebResearchRequest,
  options: { signal?: AbortSignal } = {},
): Promise<WebResearch> {
  const { signal } = options;
  const model = await getSelectedModel();
  const tools = [webSearchTool(model.id, request.domains)];
  const messages: BetaMessageParam[] = [{ role: "user", content: request.prompt }];
  const research: WebResearch = { passages: [], results: [], searchErrors: [], model: "" };

  for (let resumes = 0; ; resumes += 1) {
    throwIfAborted(signal);
    const message = await sendMessage(
      { feature: request.feature, system: request.system, messages, tools },
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

/** A page the research found, numbered for the summary, with the text cited from it. */
export interface NumberedSource {
  id: number;
  url: string;
  title: string;
  /** Every `cited_text` Claude quoted from this page. */
  quotes: string[];
}

/** Numbers every http(s) page that appeared in a citation or a search result, once each. */
export function numberSources(research: WebResearch): NumberedSource[] {
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

/**
 * The research as notes for the summary request: each non-empty passage with the ids of the
 * numbered sources it cites, and each source with its quotes.
 */
export function researchNotes(research: WebResearch, sources: NumberedSource[]) {
  const ids = new Map(sources.map((source) => [source.url, source.id]));
  const passages = research.passages
    .filter((passage) => passage.text.trim())
    .map((passage) => ({
      text: passage.text,
      sourceIds: [
        ...new Set(passage.citations.flatMap((c) => (ids.has(c.url) ? [ids.get(c.url)!] : []))),
      ],
    }));
  return {
    research: passages,
    sources: sources.map(({ id, url, title, quotes }) => ({ id, url, title, quotes })),
  };
}
