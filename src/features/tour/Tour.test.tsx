import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { placePopover } from "./placement";
import { Tour } from "./Tour";
import { TOUR_STEPS } from "./steps";

function Anchors() {
  return (
    <nav>
      {TOUR_STEPS.map((step) => (
        <a key={step.anchor} href="#" data-tour={step.anchor}>
          {step.title}
        </a>
      ))}
    </nav>
  );
}

function renderTour() {
  const onClose = vi.fn();
  render(
    <>
      <button type="button">Outside</button>
      <Anchors />
      <Tour steps={TOUR_STEPS} onClose={onClose} />
    </>,
  );
  return { onClose, user: userEvent.setup() };
}

const dialog = () => screen.getByRole("dialog");

describe("Tour", () => {
  it("has five steps, one per main screen", () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      "tour-home",
      "tour-cellar",
      "tour-add",
      "tour-sommelier",
      "tour-more",
    ]);
  });

  it("advances through every step with Next and finishes with Done", async () => {
    const { onClose, user } = renderTour();
    for (let i = 0; i < TOUR_STEPS.length; i += 1) {
      const step = TOUR_STEPS[i]!;
      expect(within(dialog()).getByRole("heading", { name: step.title })).toBeInTheDocument();
      expect(
        within(dialog()).getByText(`Step ${i + 1} of ${TOUR_STEPS.length}`),
      ).toBeInTheDocument();
      const last = i === TOUR_STEPS.length - 1;
      await user.click(within(dialog()).getByRole("button", { name: last ? "Done" : "Next" }));
    }
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("goes back a step", async () => {
    const { user } = renderTour();
    expect(within(dialog()).queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    await user.click(within(dialog()).getByRole("button", { name: "Next" }));
    await user.click(within(dialog()).getByRole("button", { name: "Back" }));
    expect(
      within(dialog()).getByRole("heading", { name: TOUR_STEPS[0]!.title }),
    ).toBeInTheDocument();
  });

  it("can be skipped", async () => {
    const { onClose, user } = renderTour();
    await user.click(within(dialog()).getByRole("button", { name: "Skip tour" }));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("works from the keyboard: arrows move, Escape closes", async () => {
    const { onClose, user } = renderTour();
    // Focus starts on the main button.
    expect(within(dialog()).getByRole("button", { name: "Next" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(
      within(dialog()).getByRole("heading", { name: TOUR_STEPS[1]!.title }),
    ).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(
      within(dialog()).getByRole("heading", { name: TOUR_STEPS[0]!.title }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("keeps Tab focus inside the tour", async () => {
    const { user } = renderTour();
    await user.click(within(dialog()).getByRole("button", { name: "Next" }));
    const buttons = within(dialog()).getAllByRole("button");
    buttons[buttons.length - 1]!.focus();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(buttons[buttons.length - 1]).toHaveFocus();
    expect(screen.getByRole("button", { name: "Outside" })).not.toHaveFocus();
  });

  it("marks the highlighted item for the current step", async () => {
    const { user } = renderTour();
    expect(document.querySelector('[data-tour="tour-home"]')).toHaveAttribute(
      "data-tour-active",
      "true",
    );
    await user.click(within(dialog()).getByRole("button", { name: "Next" }));
    expect(document.querySelector('[data-tour="tour-home"]')).not.toHaveAttribute(
      "data-tour-active",
    );
    expect(document.querySelector('[data-tour="tour-cellar"]')).toHaveAttribute(
      "data-tour-active",
      "true",
    );
  });
});

describe("placePopover", () => {
  const viewport = { width: 1280, height: 800 };
  const size = { width: 320, height: 180 };

  it("puts the card to the right of a sidebar item", () => {
    const anchor = { top: 100, left: 16, width: 224, height: 44, right: 240, bottom: 144 };
    const place = placePopover(anchor, viewport, size);
    expect(place.side).toBe("right");
    expect(place.left).toBeGreaterThan(anchor.right);
  });

  it("puts the card above a bottom-bar item", () => {
    const narrow = { width: 700, height: 700 };
    const anchor = { top: 640, left: 560, width: 140, height: 60, right: 700, bottom: 700 };
    const place = placePopover(anchor, narrow, size);
    expect(place.side).toBe("top");
    expect(place.top + size.height).toBeLessThanOrEqual(anchor.top);
    // Kept inside the window.
    expect(place.left + size.width).toBeLessThanOrEqual(narrow.width);
  });

  it("centres the card when the anchor is missing", () => {
    const place = placePopover(null, viewport, size);
    expect(place.side).toBe("center");
    expect(place.left).toBe((viewport.width - size.width) / 2);
  });
});
