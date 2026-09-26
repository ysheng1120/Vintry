import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";
import { useToast } from "./useToast";

function Trigger({ onUndo }: { onUndo?: () => void }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({
          title: "Drank 1 bottle",
          description: "Ridge Monte Bello 2019",
          action: onUndo ? { label: "Undo", onClick: onUndo } : undefined,
        })
      }
    >
      Drink
    </button>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("shows a toast in a live region", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Drink" }));
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveTextContent("Drank 1 bottle");
    expect(region).toHaveTextContent("Ridge Monte Bello 2019");
  });

  it("calls the Undo action once and closes", async () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Drink" }));
    const undo = screen.getByRole("button", { name: "Undo" });
    await userEvent.dblClick(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Drank 1 bottle")).not.toBeInTheDocument();
  });

  it("dismisses itself after 6 seconds", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "Drink" }).click();
    });
    expect(screen.getByText("Drank 1 bottle")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5900);
    });
    expect(screen.getByText("Drank 1 bottle")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("Drank 1 bottle")).not.toBeInTheDocument();
  });

  it("can be dismissed by hand", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Drink" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Drank 1 bottle")).not.toBeInTheDocument();
  });
});
