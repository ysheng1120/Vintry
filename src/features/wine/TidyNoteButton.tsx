import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tidyNote } from "../../ai/features/tidyNote";
import { useAiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { useCommandFeedback } from "../cellar/feedback";

export interface TidyNoteButtonProps {
  /** The note as typed so far. */
  text: string;
  /** Receives the tidy note; the editor shows it for the user to change and save. */
  onResult: (text: string) => void;
  className?: string;
}

/**
 * "Tidy with AI" for a tasting-note editor (R16). Hidden unless AI is ready; nothing is saved
 * here, the tidy note only replaces the editor's text.
 */
export function TidyNoteButton({ text, onResult, className }: TidyNoteButtonProps) {
  const status = useAiStatus();
  const { failed } = useCommandFeedback();
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  if (status.state !== "ready") return null;

  const tidy = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    try {
      const tidied = await tidyNote(text, { signal: controller.signal });
      if (!controller.signal.aborted) onResult(tidied);
    } catch (error) {
      if (!controller.signal.aborted) failed(error, "Couldn't tidy the note");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={!text.trim()}
      loading={busy}
      icon={<Sparkles aria-hidden="true" className="size-4" />}
      onClick={() => void tidy()}
    >
      {busy ? "Tidying…" : "Tidy with AI"}
    </Button>
  );
}

export default TidyNoteButton;
