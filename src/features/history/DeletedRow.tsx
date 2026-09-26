import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/useToast";
import { commandErrorMessage } from "../cellar/feedback";
import { purgeDeleted, restoreWine } from "../../domain/commands/wines";
import { undoBatch } from "../../domain/undo";
import { formatDate } from "../../lib/format";
import { wineLabel } from "../../domain/labels";
import type { DeletedWine } from "../../domain/selectors";

/** One row in "Recently deleted": Restore, or Delete forever after a confirmation. */
export function DeletedRow({ item }: { item: DeletedWine }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
        title: commandErrorMessage(err, "Could not restore that wine."),
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteForever() {
    setBusy(true);
    try {
      const result = await purgeDeleted({ wineId: item.wine.id });
      toast({ title: result.summary, tone: "success" });
    } catch (err) {
      toast({
        title: commandErrorMessage(err, "Could not delete that wine."),
        tone: "danger",
      });
    } finally {
      setBusy(false);
      setConfirming(false);
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
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={onRestore}>
          Restore
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          Delete forever
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Delete ${wineLabel(item.wine)} forever?`}
        description="The wine and its bottles, drinks, and notes will be removed for good."
        confirmLabel="Delete forever"
        tone="danger"
        busy={busy}
        onConfirm={() => void onDeleteForever()}
        onCancel={() => setConfirming(false)}
      />
    </li>
  );
}
