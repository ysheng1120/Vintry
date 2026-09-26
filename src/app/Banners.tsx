import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Sparkles, X } from "lucide-react";
import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { BannerApiContext, BannerListContext, type BannerSpec, type BannerTone } from "./useBanner";

export function BannerProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<BannerSpec[]>([]);

  const showBanner = useCallback((spec: BannerSpec) => {
    setBanners((list) => {
      const others = list.filter((b) => b.id !== spec.id);
      return [...others, spec].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    });
  }, []);

  const hideBanner = useCallback((id: string) => {
    setBanners((list) => (list.some((b) => b.id === id) ? list.filter((b) => b.id !== id) : list));
  }, []);

  const api = useMemo(() => ({ showBanner, hideBanner }), [showBanner, hideBanner]);

  return (
    <BannerApiContext.Provider value={api}>
      <BannerListContext.Provider value={banners}>{children}</BannerListContext.Provider>
    </BannerApiContext.Provider>
  );
}

const toneStyles: Record<BannerTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-info/25 bg-info-soft", icon: <Info className="text-info" /> },
  primary: {
    box: "border-primary/20 bg-primary-soft",
    icon: <Sparkles className="text-primary" />,
  },
  success: {
    box: "border-success/25 bg-success-soft",
    icon: <CheckCircle2 className="text-success" />,
  },
  warning: {
    box: "border-warning/25 bg-warning-soft",
    icon: <AlertTriangle className="text-warning" />,
  },
  danger: {
    box: "border-danger/25 bg-danger-soft",
    icon: <AlertTriangle className="text-danger" />,
  },
};

/** Where banners appear: the top of the main content area. */
export function BannerSlot({ className }: { className?: string }) {
  const banners = useContext(BannerListContext);
  const api = useContext(BannerApiContext);
  if (banners.length === 0) return null;

  return (
    <section aria-label="Notices" className={clsx("mb-6 flex flex-col gap-3", className)}>
      {banners.map((banner) => {
        const tone = toneStyles[banner.tone ?? "info"];
        return (
          <div
            key={banner.id}
            data-banner={banner.id}
            className={clsx(
              "flex animate-fade-in flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border px-4 py-3",
              tone.box,
            )}
          >
            <span aria-hidden="true" className="flex shrink-0 [&_svg]:size-5">
              {tone.icon}
            </span>
            <div className="min-w-[12rem] flex-1">
              <p className="font-semibold text-ink">{banner.title}</p>
              {banner.description && <p className="text-sm text-ink-muted">{banner.description}</p>}
            </div>
            <div className="flex items-center gap-1">
              {banner.secondaryAction && (
                <Button variant="ghost" size="sm" onClick={banner.secondaryAction.onClick}>
                  {banner.secondaryAction.label}
                </Button>
              )}
              {banner.action && (
                <Button
                  variant={banner.tone === "danger" ? "danger" : "primary"}
                  size="sm"
                  onClick={banner.action.onClick}
                >
                  {banner.action.label}
                </Button>
              )}
              {banner.onDismiss && (
                <button
                  type="button"
                  aria-label="Dismiss"
                  title="Dismiss"
                  onClick={() => {
                    api?.hideBanner(banner.id);
                    banner.onDismiss?.();
                  }}
                  className="inline-flex size-10 items-center justify-center rounded-xl text-ink-muted hover:bg-surface/70 hover:text-ink"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
