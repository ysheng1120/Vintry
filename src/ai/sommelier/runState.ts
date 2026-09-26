import { useSyncExternalStore } from "react";

/**
 * Live state of a running sommelier turn, kept in memory (the conversation itself is in
 * IndexedDB). The chat shows the streaming reply from here and disables sending while busy.
 */

export interface RunState {
  busy: boolean;
  /** Text of the reply being streamed, or "" between requests. */
  streamText: string;
}

const IDLE: RunState = { busy: false, streamText: "" };
const states = new Map<string, RunState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getRunState(threadId: string): RunState {
  return states.get(threadId) ?? IDLE;
}

export function isBusy(threadId: string): boolean {
  return getRunState(threadId).busy;
}

/** Marks a thread busy and returns the signal that Stop aborts. */
export function startRun(threadId: string): AbortSignal {
  const controller = new AbortController();
  controllers.set(threadId, controller);
  states.set(threadId, { busy: true, streamText: "" });
  emit();
  return controller.signal;
}

export function setStreamText(threadId: string, streamText: string): void {
  const state = getRunState(threadId);
  if (state.streamText === streamText) return;
  states.set(threadId, { ...state, streamText });
  emit();
}

export function endRun(threadId: string): void {
  controllers.delete(threadId);
  states.delete(threadId);
  emit();
}

/** Stops the request in flight for a thread, if any. */
export function stopRun(threadId: string): void {
  controllers.get(threadId)?.abort();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live run state for a thread (idle when none). */
export function useRunState(threadId: string | undefined): RunState {
  return useSyncExternalStore(subscribe, () => (threadId ? getRunState(threadId) : IDLE));
}
