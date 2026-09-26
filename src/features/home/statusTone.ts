import type { BadgeTone } from "../../components/ui/Badge";
import type { WindowStatus } from "../../domain/window";

/** Maps a wine's window status to the Badge tone that colours it (Badge spells "no window" differently). */
export function badgeToneForStatus(status: WindowStatus): BadgeTone {
  return status === "none" ? "no-window" : status;
}
