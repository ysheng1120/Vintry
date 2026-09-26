import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AiStatusNotice } from "../../ai/AiStatusNotice";
import { useSelectedModelId } from "../../ai/client";
import {
  estimateBulkCostUsd,
  estimateMissingWindows,
  getWinesWithoutWindow,
  WINDOW_BATCH_SIZE,
  type BulkEstimateResult,
  type BulkProgress,
} from "../../ai/features/estimateWindow";
import { toAiError } from "../../ai/errors";
import { formatUsd, getModel } from "../../ai/models";
import { useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { useToast } from "../../components/ui/useToast";
import type { CommandResult } from "../../domain/commands";
import { undoBatch } from "../../domain/undo";
import { pluralize } from "../../lib/format";
import { errorMessage } from "../cellar/feedback";

/** The cellar URL parameter that opens the sheet (Home's "Estimate all with AI" links to it). */
export const ESTIMATE_PARAM = "estimate";

const wines = (count: number) => pluralize(count, "wine");

/** Live count of wines in the cellar without a drinking window; undefined while loading. */
function useMissingCount(): number | undefined {
  return useLiveQuery(async () => (await getWinesWithoutWindow()).length, []);
}

/** Undo for a whole run: undoes each window, newest first, and stops at the first refusal. */
function useUndoAll() {
  const { toast } = useToast();
  return (results: CommandResult[]) => {
    const ids = results.map((r) => r.batchId).filter((id): id is string => Boolean(id));
    toast({
      title: `Added AI windows for ${wines(ids.length)}`,
      tone: "success",
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            try {
              for (const id of [...ids].reverse()) {
                const undo = await undoBatch(id);
                if (!undo.ok) {
                  toast({ title: "Couldn't undo", description: undo.reason, tone: "warning" });
                  return;
                }
              }
              toast({ title: `Removed the AI windows from ${wines(ids.length)}` });
            } catch (error) {
              toast({ title: "Couldn't undo", description: errorMessage(error), tone: "danger" });
            }
          })();
        },
      },
    });
  };
}

type Run =
  | { state: "idle" }
  | { state: "running"; progress: BulkProgress }
  | { state: "finished"; result: BulkEstimateResult };

export interface BulkEstimateSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Bulk drinking-window estimate (R9, R13): shows how many wines have no window and the
 * estimated cost, then runs 20 wines per request with progress and Cancel. Running again
 * continues with the wines that still have no window.
 */
export function BulkEstimateSheet({ open, onClose }: BulkEstimateSheetProps) {
  const status = useAiStatus();
  const modelId = useSelectedModelId();
  const count = useMissingCount();
  const undoAll = useUndoAll();
  const [run, setRun] = useState<Run>({ state: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setRun({ state: "running", progress: { done: 0, total: count ?? 0, estimated: 0 } });
    let result: BulkEstimateResult;
    try {
      result = await estimateMissingWindows({
        signal: controller.signal,
        onProgress: (progress) => setRun({ state: "running", progress }),
      });
    } catch (error) {
      // Only a database failure gets here; AI errors come back in the result.
      result = {
        done: 0,
        total: 0,
        estimated: 0,
        results: [],
        cancelled: false,
        error: toAiError(error),
      };
    }
    controllerRef.current = null;
    setRun({ state: "finished", result });
    if (result.results.length > 0) undoAll(result.results);
  };

  const close = () => {
    controllerRef.current?.abort();
    setRun({ state: "idle" });
    onClose();
  };

  const running = run.state === "running";
  const ready = status.state === "ready";
  const remaining = count ?? 0;
  const cost = estimateBulkCostUsd(modelId, remaining);
  const modelLabel = getModel(modelId)?.label ?? modelId;
  const requests = Math.ceil(remaining / WINDOW_BATCH_SIZE);
  const runLabel =
    run.state === "finished" && run.result.estimated > 0
      ? `Continue with ${wines(remaining)}`
      : `Estimate ${wines(remaining)}`;

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Estimate drinking windows"
      description="Claude suggests when to drink each wine. Every window is marked as an AI estimate, and windows you set yourself are never changed."
      closeOnBackdrop={!running}
      footer={
        running ? (
          <Button variant="secondary" onClick={() => controllerRef.current?.abort()}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              {run.state === "finished" ? "Done" : "Not now"}
            </Button>
            {ready && remaining > 0 && (
              <Button
                icon={<Sparkles aria-hidden="true" className="size-4" />}
                onClick={() => void start()}
              >
                {runLabel}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <AiStatusNotice
          status={status}
          manual={{ to: "/cellar?status=none", label: "Set windows by hand" }}
        />
        {run.state === "running" ? (
          <RunProgress progress={run.progress} />
        ) : (
          <>
            {run.state === "finished" && <RunSummary result={run.result} />}
            {count === undefined ? null : remaining === 0 ? (
              <p className="text-ink">Every wine in your cellar has a drinking window.</p>
            ) : (
              <div className="flex flex-col gap-2 text-ink">
                <p>
                  <strong>{wines(remaining)}</strong> in your cellar{" "}
                  {remaining === 1 ? "has" : "have"} no drinking window.
                </p>
                <p className="text-sm text-ink-muted">
                  Estimated cost: about{" "}
                  {cost === null ? "an unknown amount (price unknown)" : formatUsd(cost)} with{" "}
                  {modelLabel}, in {pluralize(requests, "request")} of up to {WINDOW_BATCH_SIZE}{" "}
                  wines.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function RunProgress({ progress }: { progress: BulkProgress }) {
  const total = Math.max(progress.total, progress.done, 1);
  return (
    <div className="flex flex-col gap-2" role="status">
      <progress
        value={Math.min(progress.done, total)}
        max={total}
        aria-label="Estimating drinking windows"
        className="h-2 w-full overflow-hidden rounded-full accent-primary"
      />
      <p className="text-sm text-ink-muted">
        Looked at {Math.min(progress.done, total)} of {wines(total)}, added{" "}
        {pluralize(progress.estimated, "window")}…
      </p>
    </div>
  );
}

function RunSummary({ result }: { result: BulkEstimateResult }) {
  const skipped = result.done - result.estimated;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink">
      <p className="font-medium">Added windows for {wines(result.estimated)}.</p>
      {result.cancelled && <p>Stopped. Run again to continue with the rest.</p>}
      {skipped > 0 && !result.cancelled && !result.error && (
        <p>
          Claude couldn't estimate {wines(skipped)}. You can set {skipped === 1 ? "it" : "them"} by
          hand.
        </p>
      )}
      {result.error && (
        <p role="alert" className="text-danger">
          {result.error.message} Run again to continue with the rest.
        </p>
      )}
    </div>
  );
}

/** A button that opens the sheet through the URL; hidden unless AI is ready and wines need one. */
export function BulkEstimateButton({ className }: { className?: string }) {
  const [, setParams] = useSearchParams();
  const status = useAiStatus();
  const count = useMissingCount();
  if (status.state !== "ready" || !count) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      icon={<Sparkles aria-hidden="true" className="size-4" />}
      onClick={() =>
        setParams((params) => {
          const next = new URLSearchParams(params);
          next.set(ESTIMATE_PARAM, "all");
          return next;
        })
      }
    >
      Estimate {pluralize(count, "window")} with AI
    </Button>
  );
}

/**
 * Rendered at the top of the cellar page: opens the sheet when the URL has `estimate=all`
 * and removes the parameter when the sheet closes.
 */
export default function BulkEstimate() {
  const [params, setParams] = useSearchParams();
  // Mounted only while open, so the cellar page does no extra work when it is closed.
  if (params.get(ESTIMATE_PARAM) !== "all") return null;
  return (
    <BulkEstimateSheet
      open
      onClose={() =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete(ESTIMATE_PARAM);
            return next;
          },
          { replace: true },
        )
      }
    />
  );
}
