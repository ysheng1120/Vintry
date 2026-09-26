import type { EventSource } from "../../domain/types";

/** Plain-language source names for the history timeline. */
export const EVENT_SOURCE_LABELS: Record<EventSource, string> = {
  user: "You",
  "ai-chat": "Sommelier",
  "ai-scan": "Label scan",
  "ai-describe": "Describe",
  import: "Import",
  restore: "Restore",
  sample: "Sample",
};
