import clsx from "clsx";
import { CircleCheck, CircleAlert, ClipboardPaste, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { removeApiKey, saveApiKey, testApiKey, useApiKeyHint } from "../../ai/client";
import { useAiStatus, type AiStatus } from "../../ai/useAiStatus";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { useToast } from "../../components/ui/useToast";

type Result = { ok: boolean; text: string };

function statusLine(status: AiStatus): { tone: "ok" | "off" | "problem"; text: string } {
  if (status.state === "ready") return { tone: "ok", text: "AI is ready." };
  if (status.state === "no-key") {
    return {
      tone: "off",
      text: "No key yet. AI features are off; everything else works without one.",
    };
  }
  return { tone: "problem", text: `AI is unavailable. ${status.reason}` };
}

/** Key field, Save / Test / Remove, and the live AI status line (R18, R25). */
export function AiKeySettings() {
  const status = useAiStatus();
  const hint = useApiKeyHint();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const line = statusLine(status);
  const trimmed = draft.trim();

  async function runTest(candidate?: string) {
    const outcome = await testApiKey(candidate);
    setResult(
      outcome.ok
        ? { ok: true, text: "Your key works." }
        : { ok: false, text: outcome.error.message },
    );
  }

  async function onSave() {
    if (!trimmed) return;
    setBusy("save");
    setResult(null);
    try {
      await saveApiKey(trimmed);
      setDraft("");
      setVisible(false);
      await runTest();
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    setResult(null);
    try {
      await runTest(trimmed || undefined);
    } finally {
      setBusy(null);
    }
  }

  async function onPaste() {
    try {
      const text = await navigator.clipboard.readText();
      setDraft(text.trim());
    } catch {
      toast({
        title: "Could not read the clipboard",
        description: "Click the key field and press Ctrl+V (Cmd+V on a Mac).",
      });
    }
  }

  async function onRemove() {
    await removeApiKey();
    setConfirmRemove(false);
    setResult(null);
    toast({ title: "Key removed", description: "AI features are off until you add a key." });
  }

  // The status line already shows a remembered problem; do not repeat it below the buttons.
  const showResult = result && !(status.state === "unavailable" && status.reason === result.text);

  return (
    <div className="flex flex-col gap-4">
      <p
        className={clsx(
          "flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-medium",
          line.tone === "ok" && "bg-success-soft text-success",
          line.tone === "off" && "bg-surface-muted text-ink-muted",
          line.tone === "problem" && "bg-warning-soft text-warning",
        )}
      >
        {line.tone === "ok" ? (
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        ) : (
          <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        )}
        <span>{line.text}</span>
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
        className="flex flex-col gap-3"
      >
        <Field
          label="Claude API key"
          hint={
            hint
              ? `Saved key ending in ${hint}. Paste a new key here to replace it.`
              : "Starts with sk-ant-. It is stored only in this browser."
          }
        >
          <div className="flex gap-2">
            <Input
              type={visible ? "text" : "password"}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={hint ? "Paste a new key" : "sk-ant-…"}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <IconButton
              variant="secondary"
              label={visible ? "Hide key" : "Show key"}
              aria-pressed={visible}
              icon={visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              onClick={() => setVisible((v) => !v)}
            />
            <IconButton
              variant="secondary"
              label="Paste key"
              icon={<ClipboardPaste className="size-5" />}
              onClick={() => void onPaste()}
            />
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!trimmed || busy !== null} loading={busy === "save"}>
            Save key
          </Button>
          <Button
            variant="secondary"
            disabled={(!trimmed && !hint) || busy !== null}
            loading={busy === "test"}
            onClick={() => void onTest()}
          >
            Test key
          </Button>
          {hint && (
            <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
              Remove key
            </Button>
          )}
          <Link
            to="/help#ai-key"
            className="ml-auto text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            How to get a key
          </Link>
        </div>
      </form>

      <p role="status" className="min-h-6 text-sm">
        {showResult && (
          <span
            className={clsx(
              "inline-flex items-start gap-1.5 font-medium",
              result.ok ? "text-success" : "text-danger",
            )}
          >
            {result.ok ? (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            )}
            {result.text}
          </span>
        )}
      </p>

      <ConfirmDialog
        open={confirmRemove}
        tone="danger"
        title="Remove your AI key?"
        description="AI features turn off until you add a key again. Your cellar is not affected."
        confirmLabel="Remove key"
        onConfirm={() => void onRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
