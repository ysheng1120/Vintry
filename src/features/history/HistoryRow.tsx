import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/useToast";
import { checkUndo, undoBatch, type UndoCheck } from "../../domain/undo";
import type { EventBatch } from "../../domain/types";
import { relativeTime } from "./relativeTime";
import { EVENT_SOURCE_LABELS } from "./sourceLabels";

/** One row in the "All changes" timeline: summary, source, when, and an Undo button. */
export function HistoryRow({ batch }: { batch: EventBatch }) {
  const { toast } = useToast();
  const [check, setCheck] = useState<UndoCheck | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    checkUndo(batch.id).then((result) => {
      if (alive) setCheck(result);
    });
    return () => {
      alive = false;
    };
  }, [batch.id, batch.undoneAt]);

  const reason = batch.undoneAt
    ? "This change has already been undone."
    : check && !check.ok
      ? check.reason
      : undefined;
  const disabled = busy || Boolean(batch.undoneAt) || !check || !check.ok;

  async function onUndo() {
    setBusy(true);
    try {
      const result = await undoBatch(batch.id);
      if (result.ok) toast({ title: result.summary, tone: "success" });
      else toast({ title: "Can't undo that change", description: result.reason, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{batch.summary}</p>
        <p className="text-sm text-ink-muted">
          {EVENT_SOURCE_LABELS[batch.source]} · {relativeTime(batch.createdAt)}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        disabled={disabled}
        title={reason}
        onClick={onUndo}
      >
        Undo
      </Button>
    </li>
  );
}
