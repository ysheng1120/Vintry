import { Sparkles } from "lucide-react";
import { useState } from "react";
import { applyWindowEstimate, estimateWindow } from "../../ai/features/estimateWindow";
import { useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useToast } from "../../components/ui/useToast";
import type { Wine } from "../../domain/types";
import { useCommandFeedback } from "../../app/commandFeedback";
import { windowRange } from "../../domain/window";

const userSetWindow = (wine: Wine) =>
  wine.windowSource === "user" && (wine.windowFrom !== null || wine.windowTo !== null);

/**
 * "Estimate with AI" on wine detail (R13). Hidden unless AI is ready. A window the user set
 * themselves is only replaced after they confirm (R17); the estimate shows as "AI estimate".
 */
export default function EstimateWindowButton({ wine }: { wine: Wine }) {
  const status = useAiStatus();
  const { toast } = useToast();
  const { done, failed } = useCommandFeedback();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (status.state !== "ready") return null;

  const run = async (overwrite: boolean) => {
    setConfirming(false);
    setBusy(true);
    try {
      const estimate = await estimateWindow(wine);
      if (!estimate) {
        toast({
          title: "Claude couldn't estimate a window for this wine",
          description: "You can set one by hand.",
          tone: "warning",
        });
        return;
      }
      done(await applyWindowEstimate(estimate, { overwrite }));
    } catch (error) {
      failed(error, "Couldn't estimate the window");
    } finally {
      setBusy(false);
    }
  };

  const userSet = userSetWindow(wine);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        icon={<Sparkles aria-hidden="true" className="size-4" />}
        onClick={() => (userSet ? setConfirming(true) : void run(false))}
      >
        {busy ? "Estimating…" : "Estimate with AI"}
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Replace your window?"
        description={`You set this window yourself (${windowRange(wine.windowFrom, wine.windowTo)}). An AI estimate would replace it. You can undo afterwards.`}
        confirmLabel="Estimate and replace"
        onConfirm={() => void run(true)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
