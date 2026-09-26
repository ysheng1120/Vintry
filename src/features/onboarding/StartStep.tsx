import {
  ArchiveRestore,
  Camera,
  ChevronRight,
  CircleAlert,
  Compass,
  FileSpreadsheet,
  MessageSquareText,
  PenLine,
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type ComponentType, type SVGProps } from "react";
import { useNavigate } from "react-router";
import { Spinner } from "../../components/ui/Spinner";
import { parseBackup } from "../../db/backup";
import { restoreBackupCommand } from "../../domain/commands/admin";
import { loadSampleCellar } from "../../domain/commands/sample";
import { useCommandFeedback } from "../cellar/feedback";
import { finishOnboarding } from "./firstRun";
import type { StepProps } from "./StepLayout";
import { StepLayout } from "./StepLayout";

type OptionId = "scan" | "describe" | "manual" | "import" | "sample" | "restore";

interface StartOption {
  id: OptionId;
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Page to open; sample and restore land on Home after their work. */
  to?: string;
}

const OPTIONS: StartOption[] = [
  {
    id: "scan",
    title: "Scan a label",
    description: "Take or upload a photo. Needs an AI key.",
    icon: Camera,
    to: "/add/scan",
  },
  {
    id: "describe",
    title: "Describe it",
    description: "Type one sentence about a wine. Needs an AI key.",
    icon: MessageSquareText,
    to: "/add/describe",
  },
  {
    id: "manual",
    title: "Add by hand",
    description: "A short form. Works offline, no key needed.",
    icon: PenLine,
    to: "/add/manual",
  },
  {
    id: "import",
    title: "Import a file",
    description: "A CSV from CellarTracker, Vivino, or a spreadsheet.",
    icon: FileSpreadsheet,
    to: "/import",
  },
  {
    id: "sample",
    title: "Explore a sample cellar",
    description: "Try Vintry with sample wines. Clear them in one click.",
    icon: Compass,
  },
  {
    id: "restore",
    title: "Restore from a Vintry backup",
    description: "Moving from another computer or browser? Bring your cellar here.",
    icon: ArchiveRestore,
  },
];

/** Step 4: "How do you want to start?" Any choice finishes onboarding (R28). */
export function StartStep({ headingRef }: Pick<StepProps, "headingRef">) {
  const navigate = useNavigate();
  const { done, failed } = useCommandFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<OptionId | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function choose(option: StartOption) {
    if (busy) return;
    if (option.id === "restore") {
      fileRef.current?.click();
      return;
    }
    if (option.id === "sample") {
      setBusy("sample");
      try {
        done(await loadSampleCellar());
      } catch (error) {
        failed(error, "Couldn't load the sample cellar");
        setBusy(null);
        return;
      }
    }
    await finishOnboarding();
    void navigate(option.to ?? "/");
  }

  async function onBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRestoreError(null);
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      setRestoreError(parsed.message);
      return;
    }
    setBusy("restore");
    try {
      const result = await restoreBackupCommand.run(parsed.backup);
      // The backup brings its own settings; this device has now finished onboarding.
      await finishOnboarding();
      done(result);
      void navigate("/");
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "The backup could not be restored.");
      setBusy(null);
    }
  }

  return (
    <StepLayout
      headingRef={headingRef}
      title="How do you want to start?"
      intro="Pick one. You can do all of these later from Add wine and More."
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => void choose(option)}
                disabled={busy !== null}
                aria-busy={busy === option.id || undefined}
                className="group flex h-full w-full items-start gap-4 rounded-2xl border border-border bg-surface p-5 text-left shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-70"
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"
                >
                  {busy === option.id ? <Spinner /> : <Icon className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg font-semibold text-ink">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">{option.description}</span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="mt-3 size-5 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </li>
          );
        })}
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        aria-label="Vintry backup file to restore"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => void onBackupFile(e)}
      />
      {restoreError && (
        <p role="alert" className="mt-4 flex items-start gap-2 font-medium text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          {restoreError}
        </p>
      )}
    </StepLayout>
  );
}
