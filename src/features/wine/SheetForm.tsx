import { AlertTriangle } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";

export interface SheetFormProps {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
  /** Extra footer button shown on the left (for example "Clear window"). */
  secondary?: ReactNode;
  children: ReactNode;
}

/** A Sheet holding one form: Enter submits, the footer has Cancel and the submit button. */
export function SheetForm({
  title,
  description,
  submitLabel,
  busy,
  error,
  onSubmit,
  onClose,
  secondary,
  children,
}: SheetFormProps) {
  const formId = useId();
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          {secondary && <div className="mr-auto">{secondary}</div>}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        {children}
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm font-medium text-danger">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
