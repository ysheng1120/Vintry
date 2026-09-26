import { Sparkles } from "lucide-react";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import type { WindowSource } from "../../domain/types";
import { WINDOW_STATUS_LABELS, type WindowStatus } from "../../domain/window";

const STATUS_TONES: Record<WindowStatus, BadgeTone> = {
  hold: "hold",
  ready: "ready",
  "drink-soon": "drink-soon",
  "past-peak": "past-peak",
  none: "no-window",
};

/** Drinking-window status badge (R4). */
export function StatusBadge({ status, className }: { status: WindowStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {WINDOW_STATUS_LABELS[status]}
    </Badge>
  );
}

const SOURCE_LABELS: Record<WindowSource, string> = {
  user: "Your window",
  ai: "AI estimate",
  import: "From import",
};

/** Where a drinking window came from (R4, R17): AI estimates get the accent badge. */
export function WindowSourceBadge({ source }: { source: WindowSource }) {
  return (
    <Badge tone={source === "ai" ? "accent" : "neutral"}>
      {source === "ai" && <Sparkles aria-hidden="true" />}
      {SOURCE_LABELS[source]}
    </Badge>
  );
}
