import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { BannerProvider, BannerSlot } from "./Banners";
import { useBanner, type BannerSpec } from "./useBanner";

function Show({ spec }: { spec: BannerSpec }) {
  const { showBanner, hideBanner } = useBanner();
  useEffect(() => {
    showBanner(spec);
  }, [showBanner, spec]);
  return (
    <button type="button" onClick={() => hideBanner(spec.id)}>
      Hide {spec.id}
    </button>
  );
}

describe("Banners", () => {
  it("renders registered banners in the slot with their action", async () => {
    const onClick = vi.fn();
    render(
      <BannerProvider>
        <BannerSlot />
        <Show
          spec={{
            id: "backup",
            title: "Time for a backup",
            description: "You made 20 changes since your last backup.",
            action: { label: "Back up now", onClick },
          }}
        />
      </BannerProvider>,
    );
    const banner = screen.getByRole("region", { name: "Notices" });
    expect(banner).toHaveTextContent("Time for a backup");
    expect(banner).toHaveTextContent("You made 20 changes since your last backup.");
    await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hides a banner by id", async () => {
    render(
      <BannerProvider>
        <BannerSlot />
        <Show spec={{ id: "sample", title: "You are exploring the sample cellar" }} />
      </BannerProvider>,
    );
    expect(screen.getByText("You are exploring the sample cellar")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide sample" }));
    expect(screen.queryByText("You are exploring the sample cellar")).not.toBeInTheDocument();
  });

  it("offers a dismiss button when onDismiss is given", async () => {
    const onDismiss = vi.fn();
    render(
      <BannerProvider>
        <BannerSlot />
        <Show spec={{ id: "safari", title: "Add Vintry to your Dock", onDismiss }} />
      </BannerProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Add Vintry to your Dock")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no banners", () => {
    render(
      <BannerProvider>
        <BannerSlot />
      </BannerProvider>,
    );
    expect(screen.queryByRole("region", { name: "Notices" })).not.toBeInTheDocument();
  });
});
