import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/useToast";
import { CommandError } from "../../domain/commands/core";
import { restoreWine } from "../../domain/commands/wines";
import { undoBatch } from "../../domain/undo";
import { formatDate } from "../../lib/format";
import { wineLabel } from "../../domain/labels";
import type { DeletedWine } from "../../domain/selectors";

/** One row in "Recently deleted": Restore only. Purging a single wine has no command yet. */
export function DeletedRow({ item }: { item: DeletedWine }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function onRestore() {
    setBusy(true);
    try {
      const result = await restoreWine({ wineId: item.wine.id });
      toast({
        title: result.summary,
        tone: "success",
        action: result.batchId
          ? { label: "Undo", onClick: () => void undoBatch(result.batchId!) }
          : undefined,
      });
    } catch (err) {
      toast({
        title: err instanceof CommandError ? err.message : "Could not restore that wine.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{wineLabel(item.wine)}</p>
        <p className="text-sm text-ink-muted">
          Deleted {formatDate(item.deletedAt)} · removed for good on {formatDate(item.purgeOn)}
        </p>
      </div>
      <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={onRestore}>
        Restore
      </Button>
    </li>
  );
}
