import { useSyncExternalStore } from "react";
import { useSetting } from "../db/settings";
import { AI_LAST_ERROR_KEY, useHasApiKey, type StoredAiError } from "./client";
import { AI_ERROR_MESSAGES } from "./errors";

export type AiStatus =
  { state: "ready" } | { state: "no-key" } | { state: "unavailable"; reason: string };

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Live `navigator.onLine`. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Live AI availability for AI entry points (R18): no key, unavailable (offline, or the last
 * request found a key or billing problem), or ready. A later successful request clears the
 * remembered problem.
 */
export function useAiStatus(): AiStatus {
  const hasKey = useHasApiKey();
  const online = useOnline();
  const lastError = useSetting<StoredAiError | null>(AI_LAST_ERROR_KEY, null);

  if (!hasKey) return { state: "no-key" };
  if (!online) return { state: "unavailable", reason: AI_ERROR_MESSAGES.offline };
  if (lastError) return { state: "unavailable", reason: lastError.message };
  return { state: "ready" };
}

/** A short note for an AI button or tile when AI cannot run right now; null when it is ready. */
export function aiStatusNote(status: AiStatus): string | null {
  if (status.state === "no-key") return "Needs AI key";
  if (status.state === "unavailable") {
    return status.reason === AI_ERROR_MESSAGES.offline
      ? "You are offline"
      : "AI unavailable right now";
  }
  return null;
}
