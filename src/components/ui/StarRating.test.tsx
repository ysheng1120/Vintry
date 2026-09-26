import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { StarRating } from "./StarRating";

function Harness({ initial = null }: { initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <StarRating label="Your rating" value={value} onChange={setValue} />
      <output>{value === null ? "none" : value}</output>
    </>
  );
}

describe("StarRating", () => {
  it("shows a read-only rating as stars out of five", () => {
    render(<StarRating value={70} />);
    expect(screen.getByRole("img", { name: "Rated 3.5 out of 5" })).toBeInTheDocument();
  });

  it("is a keyboard-operable slider in half-star steps stored as 0-100", async () => {
    render(<Harness initial={60} />);
    const slider = screen.getByRole("slider", { name: "Your rating" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    expect(slider).toHaveAttribute("aria-valuetext", "3 out of 5 stars");
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("70");
    expect(slider).toHaveAttribute("aria-valuetext", "3.5 out of 5 stars");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("status")).toHaveTextContent("40");
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("status")).toHaveTextContent("100");
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("status")).toHaveTextContent("0");
    await userEvent.keyboard("4");
    expect(screen.getByRole("status")).toHaveTextContent("80");
    await userEvent.keyboard("{Backspace}");
    expect(screen.getByRole("status")).toHaveTextContent("none");
    expect(slider).toHaveAttribute("aria-valuetext", "Not rated");
  });

  it("sets a whole star when a star is clicked", async () => {
    render(<Harness />);
    const stars = screen.getByRole("slider").querySelectorAll("[data-star]");
    await userEvent.click(stars[3] as Element);
    expect(screen.getByRole("status")).toHaveTextContent("80");
  });
});
