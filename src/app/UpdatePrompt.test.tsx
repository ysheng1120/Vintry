import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui/Toast";
import { BannerProvider, BannerSlot } from "./Banners";
import { UpdatePrompt } from "./UpdatePrompt";
import { pwaCalls, resetTestPwa, setPwa } from "./testing";

vi.mock("./pwaRegister", async () => (await import("./testing")).pwaModule);

function renderPrompt() {
  return render(
    <ToastProvider>
      <BannerProvider>
        <BannerSlot />
        <UpdatePrompt />
      </BannerProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  resetTestPwa();
});

describe("UpdatePrompt", () => {
  it("stays quiet until a new version is waiting", () => {
    renderPrompt();
    expect(screen.queryByText(/new version/i)).not.toBeInTheDocument();
  });

  it("offers Reload when a new version is available, which activates the new service worker", async () => {
    renderPrompt();
    act(() => setPwa({ needRefresh: true }));
    expect(screen.getByText("A new version of Vintry is available")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(pwaCalls.updateServiceWorker).toBe(1);
  });

  it("can be put off until later", async () => {
    renderPrompt();
    act(() => setPwa({ needRefresh: true }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("A new version of Vintry is available")).not.toBeInTheDocument();
  });

  it("tells the user once when the app is ready to work offline", () => {
    renderPrompt();
    act(() => setPwa({ offlineReady: true }));
    expect(screen.getByText("Vintry is ready to work offline")).toBeInTheDocument();
  });
});
