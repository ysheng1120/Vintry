import clsx from "clsx";
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { scanLabel } from "../../ai/features/scanLabel";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import type { CommandResult } from "../../domain/commands";
import { newId } from "../../lib/id";
import { prepareLabelImage } from "../../lib/image";
import { errorMessage, useCommandFeedback } from "../../app/commandFeedback";
import { DraftCard } from "./DraftCard";
import type { BottleDraft } from "./draft";

/** More photos than this and the request storm gets silly; the rest are simply not read. */
export const MAX_BATCH_IMAGES = 12;

/** At most this many photos are read at the same time. */
const CONCURRENCY = 2;

type ItemState =
  | { kind: "waiting" }
  | { kind: "reading" }
  | { kind: "ready"; draft: BottleDraft }
  | { kind: "failed"; message: string }
  | { kind: "saved"; wineId: string | null };

interface BatchItem {
  id: string;
  file: File;
  state: ItemState;
}

/** Runs `worker` over `items`, never more than `limit` at the same time. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item) await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export interface BatchScanProps {
  /** The photos chosen or dropped; only the first MAX_BATCH_IMAGES are read. */
  files: File[];
  /** The collector wants to pick more photos (back to the single/batch picker). */
  onScanMore: () => void;
  /** The collector is done with this batch. */
  onDone: () => void;
}

/**
 * Label scan, several photos at once (R11): each photo is read into its own draft, at most
 * CONCURRENCY at a time, and the collector checks and saves each on its own DraftCard. Saving
 * one does not leave the batch (unlike the single-photo flow in ScanPage).
 */
export default function BatchScan({ files, onScanMore, onDone }: BatchScanProps) {
  const { done } = useCommandFeedback();
  const capped = files.slice(0, MAX_BATCH_IMAGES);
  const truncated = files.length > capped.length;

  const [items, setItems] = useState<BatchItem[]>(() =>
    capped.map((file) => ({
      id: newId(),
      file,
      state: { kind: "waiting" },
    })),
  );
  const [started, setStarted] = useState(false);
  // An item the collector explicitly opened or closed; otherwise the first ready, not-yet-seen
  // draft opens on its own (below), and moving past a saved or dismissed one does the same.
  const [manualExpand, setManualExpand] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const controllerRef = useRef<AbortController | null>(null);

  // A read still running when the batch closes is cancelled.
  useEffect(() => {
    controllerRef.current = new AbortController();
    return () => controllerRef.current?.abort();
  }, []);

  const readyItem = (id: string | null) =>
    id !== null && items.find((item) => item.id === id)?.state.kind === "ready";
  const expandedId = readyItem(manualExpand)
    ? manualExpand
    : (items.find((item) => item.state.kind === "ready" && !dismissed.has(item.id))?.id ?? null);

  const setItemState = (id: string, state: ItemState) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, state } : item)));

  const read = async (item: BatchItem) => {
    setItemState(item.id, { kind: "reading" });
    const signal = controllerRef.current?.signal;
    try {
      const prepared = await prepareLabelImage(item.file);
      if (signal?.aborted) return;
      const draft = await scanLabel(prepared, { signal });
      if (signal?.aborted) return;
      setItemState(item.id, { kind: "ready", draft });
    } catch (e) {
      if (signal?.aborted) return;
      setItemState(item.id, { kind: "failed", message: errorMessage(e) });
    }
  };

  const start = () => {
    setStarted(true);
    void runPool(items, CONCURRENCY, read);
  };

  const doneCount = items.filter(
    (item) => item.state.kind !== "waiting" && item.state.kind !== "reading",
  ).length;

  if (!started) {
    return (
      <div className="flex flex-col gap-4">
        {truncated && (
          <p role="alert" className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-ink">
            You chose {files.length} photos; Vintry reads the first {MAX_BATCH_IMAGES}.
          </p>
        )}
        <Card padding="lg" className="flex flex-col items-center gap-4">
          <div className="grid w-full grid-cols-4 gap-2 sm:grid-cols-6">
            {items.map((item) => (
              <Thumbnail
                key={item.id}
                file={item.file}
                className="aspect-square w-full rounded-lg border border-border object-cover"
              />
            ))}
          </div>
          <p className="text-center text-sm text-ink-muted">
            This sends {items.length} photos to Claude with your key.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={start}>
              Read {items.length} label{items.length === 1 ? "" : "s"}
            </Button>
            <Button variant="secondary" onClick={onScanMore}>
              Choose different photos
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="text-sm font-medium text-ink-muted">
        Read {doneCount} of {items.length} labels
      </p>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <BatchItemRow
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onExpand={() => {
              setDismissed((prev) => {
                if (!prev.has(item.id)) return prev;
                const next = new Set(prev);
                next.delete(item.id);
                return next;
              });
              setManualExpand(item.id);
            }}
            onRetry={() => void read(item)}
            onSaved={(result, draft) => {
              const [wineId] = result.touched.wineIds;
              done(result, { onUndone: () => setItemState(item.id, { kind: "ready", draft }) });
              setItemState(item.id, { kind: "saved", wineId: wineId ?? null });
              setManualExpand(null);
            }}
            onCancel={() => {
              setDismissed((prev) => new Set(prev).add(item.id));
              setManualExpand(null);
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onScanMore}>
          Scan more
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

interface RowProps {
  item: BatchItem;
  expanded: boolean;
  onExpand: () => void;
  onRetry: () => void;
  onSaved: (result: CommandResult, draft: BottleDraft) => void;
  onCancel: () => void;
}

function BatchItemRow({ item, expanded, onExpand, onRetry, onSaved, onCancel }: RowProps) {
  const { state } = item;

  if (state.kind === "ready" && expanded) {
    return (
      <Card padding="lg">
        <DraftCard
          drafts={[state.draft]}
          source="ai-scan"
          onSaved={(result) => onSaved(result, state.draft)}
          onCancel={onCancel}
        />
      </Card>
    );
  }

  return (
    <Card
      padding="sm"
      className={clsx(
        "flex items-center gap-3",
        state.kind === "ready" && "cursor-pointer hover:border-border-strong",
      )}
      role={state.kind === "ready" ? "button" : undefined}
      tabIndex={state.kind === "ready" ? 0 : undefined}
      onClick={state.kind === "ready" ? onExpand : undefined}
      onKeyDown={
        state.kind === "ready"
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onExpand();
              }
            }
          : undefined
      }
    >
      <Thumbnail
        file={item.file}
        className="size-12 shrink-0 rounded-lg border border-border object-cover"
      />
      <div className="min-w-0 flex-1">
        {state.kind === "waiting" && <p className="text-sm text-ink-muted">Waiting…</p>}
        {state.kind === "reading" && (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Reading the label…
          </p>
        )}
        {state.kind === "ready" && <p className="text-sm font-medium text-ink">Ready to check</p>}
        {state.kind === "failed" && (
          <p role="alert" className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            {state.message}
          </p>
        )}
        {state.kind === "saved" && (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
            Saved
            {state.wineId && (
              <Link
                to={`/wine/${state.wineId}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-primary underline"
              >
                View wine
              </Link>
            )}
          </p>
        )}
      </div>
      {state.kind === "ready" && (
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      )}
      {state.kind === "failed" && (
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw aria-hidden="true" className="size-4" />}
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          Retry
        </Button>
      )}
    </Card>
  );
}

/**
 * A photo preview. Each image makes its own object URL and frees it when it unmounts (a React 19
 * ref cleanup), so StrictMode's extra mount in development cannot free a URL still in use.
 */
function Thumbnail({ file, className }: { file: File; className?: string }) {
  return (
    <img
      alt=""
      className={className}
      ref={(img) => {
        if (!img) return;
        const url = URL.createObjectURL(file);
        img.src = url;
        return () => URL.revokeObjectURL(url);
      }}
    />
  );
}
