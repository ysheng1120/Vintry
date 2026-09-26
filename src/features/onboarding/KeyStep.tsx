import { ArrowRight, CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import { useState, type FormEvent } from "react";
import { saveApiKey, testApiKey, useHasApiKey, useSelectedModelId } from "../../ai/client";
import { formatUsd, getModel, labelScanCostExample } from "../../ai/models";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { StepLayout, type StepProps } from "./StepLayout";

type Result = { ok: true } | { ok: false; message: string };

/** "One label scan costs about $0.023 with Best (Claude Opus 5)", from the model table (KTD3). */
function CostExample() {
  const model = getModel(useSelectedModelId());
  const cost = model ? labelScanCostExample(model.id) : null;
  if (!model || cost === null) return null;
  return (
    <p>
      One label scan costs about <strong className="text-ink">{formatUsd(cost)}</strong> with{" "}
      {model.label}. You pay Anthropic directly. There is no subscription, and you can choose a
      cheaper model in Settings.
    </p>
  );
}

/** Step 3: an optional AI key, with a test before it is saved (R25, R28). */
export function KeyStep({ headingRef, onNext }: StepProps) {
  const hasKey = useHasApiKey();
  const [draft, setDraft] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function onTest(event: FormEvent) {
    event.preventDefault();
    const key = draft.trim();
    if (!key) return;
    setTesting(true);
    setResult(null);
    try {
      const outcome = await testApiKey(key);
      if (outcome.ok) {
        await saveApiKey(key);
        setDraft("");
        setResult({ ok: true });
      } else {
        setResult({ ok: false, message: outcome.error.message });
      }
    } finally {
      setTesting(false);
    }
  }

  const saved = hasKey || result?.ok === true;
  return (
    <StepLayout
      headingRef={headingRef}
      title="Add an AI key (optional)"
      intro="With a key, Vintry can scan labels, turn one sentence into a wine, estimate drinking windows, and answer questions about your cellar. Everything else works without one, and you can add a key later in Settings."
      footer={
        saved ? (
          <Button size="lg" onClick={onNext}>
            Continue
            <ArrowRight aria-hidden="true" className="size-5" />
          </Button>
        ) : (
          <Button variant="ghost" size="lg" onClick={onNext}>
            Skip for now
          </Button>
        )
      }
    >
      <div className="space-y-6 text-ink-muted">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold text-ink">Get a key in 3 steps</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 marker:font-semibold marker:text-ink-subtle">
            <li>
              Go to{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                console.anthropic.com
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>{" "}
              and create an account.
            </li>
            <li>Open Billing and add a small amount of credit, for example $5.</li>
            <li>Open API Keys, click Create Key, and copy the key. It starts with sk-ant-.</li>
          </ol>
        </div>

        <CostExample />

        {saved ? (
          <p role="status" className="flex items-center gap-2 font-medium text-success">
            <CircleCheck aria-hidden="true" className="size-5" />
            {result?.ok ? "Your key works. It is saved on this computer." : "Your key is saved."}
          </p>
        ) : (
          <form onSubmit={onTest} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Your API key" className="flex-1">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary" loading={testing} disabled={!draft.trim()}>
              Test key
            </Button>
          </form>
        )}
        {result && !result.ok && (
          <p role="alert" className="flex items-start gap-2 font-medium text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {result.message}
          </p>
        )}

        <p className="text-sm text-ink-subtle">
          AI features send the text, photo, or cellar details they use to Anthropic. Nothing else
          leaves your computer.
        </p>
      </div>
    </StepLayout>
  );
}
