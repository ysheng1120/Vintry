import type { Wine } from "../../domain/types";

// Stub owned by U8 (AI drinking-window estimate). U5's wine detail renders it next to the
// drinking window; U8 replaces the body and keeps this props shape.
export default function EstimateWindowButton({ wine }: { wine: Wine }) {
  void wine;
  return null;
}
