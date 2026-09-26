import { createContext, useContext } from "react";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

export interface ToastOptions {
  title: string;
  description?: string;
  /** One action, e.g. Undo. Its handler runs at most once, then the toast closes. */
  action?: { label: string; onClick: () => void };
  tone?: ToastTone;
  /** Milliseconds before it closes on its own. Default 6000. */
  duration?: number;
}

export interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export const TOAST_DURATION_MS = 6000;

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
