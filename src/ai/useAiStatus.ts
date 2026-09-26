// Contract stub owned by U7 (AI foundation). U7 replaces the body; keep the exported shape.
export type AiStatus =
  { state: "ready" } | { state: "no-key" } | { state: "unavailable"; reason: string };

/** Live AI availability for AI entry points (R18). */
export function useAiStatus(): AiStatus {
  return { state: "no-key" };
}
