import { useCallback } from "react";
import { useToast } from "../../components/ui/useToast";
import type { CommandResult } from "../../domain/commands";
import { undoBatch } from "../../domain/undo";

/** A plain-language message for a failed command or unexpected error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

/**
 * Toasts for command results: `done` shows the summary with an Undo action (R6) that calls
 * `undoBatch` and reports a refusal; `failed` shows why a command did not run.
 */
export function useCommandFeedback() {
  const { toast } = useToast();

  const done = useCallback(
    (result: CommandResult, options: { onUndone?: () => void; description?: string } = {}) => {
      const { batchId } = result;
      if (!batchId) {
        toast({ title: result.summary, description: options.description });
        return;
      }
      toast({
        title: result.summary,
        description: options.description,
        tone: "success",
        action: {
          label: "Undo",
          onClick: () => {
            undoBatch(batchId)
              .then((undo) => {
                if (undo.ok) {
                  toast({ title: undo.summary });
                  options.onUndone?.();
                } else {
                  toast({ title: "Couldn't undo", description: undo.reason, tone: "warning" });
                }
              })
              .catch((error: unknown) =>
                toast({ title: "Couldn't undo", description: errorMessage(error), tone: "danger" }),
              );
          },
        },
      });
    },
    [toast],
  );

  const failed = useCallback(
    (error: unknown, title = "That didn't work") => {
      toast({ title, description: errorMessage(error), tone: "danger" });
    },
    [toast],
  );

  return { done, failed };
}
