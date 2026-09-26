import { createContext, useContext, type ReactNode } from "react";

export type BannerTone = "info" | "primary" | "success" | "warning" | "danger";

export interface BannerSpec {
  /** Stable id; showing a banner with the same id replaces it. */
  id: string;
  title: string;
  description?: ReactNode;
  tone?: BannerTone;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  /** When given, the banner shows a Dismiss button; it hides the banner and calls this. */
  onDismiss?: () => void;
  /** Higher shows first. Default 0. */
  priority?: number;
}

export interface BannerApi {
  showBanner: (spec: BannerSpec) => void;
  hideBanner: (id: string) => void;
}

export const BannerApiContext = createContext<BannerApi | null>(null);
export const BannerListContext = createContext<BannerSpec[]>([]);

/**
 * Banners are app-level notices above the page content (backup reminder, sample data,
 * Safari install tip, new version, reload after an upgrade in another tab).
 */
export function useBanner(): BannerApi {
  const api = useContext(BannerApiContext);
  if (!api) throw new Error("useBanner must be used inside <BannerProvider>");
  return api;
}
