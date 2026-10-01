import { aiStatusNote, useAiStatus } from "../../ai/useAiStatus";
import { Card } from "../../components/ui/Card";
import type { Wine } from "../../domain/types";
import ProfileSection from "./AboutWineCard";
import CriticsSection from "./CriticsCard";
import PriceSection from "./PriceSection";

export interface WineGuideCardProps {
  wine: Wine;
}

/**
 * "About this wine": one card on the wine page holding the AI profile, what critics say, and
 * shop prices as stacked sections, not tabs (KTD5), so each section keeps its own state and a
 * running request is never cancelled by switching away. The AI status note shows once here.
 * Render it with `key={wine.id}` so a different wine starts with fresh section state.
 */
export default function WineGuideCard({ wine }: WineGuideCardProps) {
  const note = aiStatusNote(useAiStatus());
  return (
    <Card padding="lg">
      <h2 className="text-lg font-semibold">About this wine</h2>
      {note && <p className="mt-1 text-xs text-ink-muted">{note}</p>}
      <div className="mt-4 flex flex-col divide-y divide-border *:py-4 *:first:pt-0 *:last:pb-0">
        <ProfileSection wine={wine} />
        <CriticsSection wine={wine} />
        <PriceSection wine={wine} />
      </div>
    </Card>
  );
}
