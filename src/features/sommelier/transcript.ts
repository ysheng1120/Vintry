import type { Proposal, StoredMessage } from "../../ai/sommelier/thread";

/** What the chat shows for a thread's stored rows. Context and tool-result rows stay hidden. */
export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      chips: string[];
      wineIds: string[];
      proposals: { toolUseId: string; proposal: Proposal }[];
    }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" };

function textOf(content: StoredMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

export function toTranscript(rows: StoredMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (const row of rows) {
    const { meta } = row;
    if (meta.kind === "user") items.push({ kind: "user", id: row.id, text: textOf(row.content) });
    else if (meta.kind === "notice") {
      items.push({ kind: "notice", id: row.id, text: meta.text ?? "", tone: meta.tone ?? "info" });
    } else if (meta.kind === "assistant") {
      const tools = meta.tools ?? [];
      items.push({
        kind: "assistant",
        id: row.id,
        text: textOf(row.content),
        chips: tools.flatMap((t) => (t.chip ? [t.chip] : [])),
        wineIds: [...new Set(tools.flatMap((t) => t.wineIds))],
        proposals: tools.flatMap((t) =>
          t.proposal ? [{ toolUseId: t.id, proposal: t.proposal }] : [],
        ),
      });
    }
  }
  return items;
}
