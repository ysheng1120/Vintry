import { useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button red and focuses Cancel first. */
  tone?: "primary" | "danger";
  /** Shows a spinner on the confirm button while an async action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      variant="dialog"
      size="sm"
      role="alertdialog"
      hideClose
      closeOnBackdrop={false}
      initialFocus={tone === "danger" ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Sheet>
  );
}
