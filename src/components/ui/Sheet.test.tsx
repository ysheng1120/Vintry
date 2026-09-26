import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Sheet } from "./Sheet";

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit wine</Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Edit wine"
        description="Change details"
      >
        <label>
          Producer
          <input />
        </label>
        <Button>Save</Button>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("opens as a modal dialog and moves focus inside", async () => {
    render(<SheetHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit wine" }));
    const dialog = screen.getByRole("dialog", { name: "Edit wine" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Change details");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("traps focus: Tab from the last element wraps to the first, Shift+Tab wraps back", async () => {
    render(<SheetHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit wine" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<SheetHarness />);
    const trigger = screen.getByRole("button", { name: "Edit wine" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes from its close button", async () => {
    render(<SheetHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit wine" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("confirms once and can be cancelled", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete this wine?"
        description="You can restore it from History for 30 days."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete this wine?" });
    expect(dialog).toHaveAccessibleDescription("You can restore it from History for 30 days.");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
