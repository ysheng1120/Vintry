import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WindowBar } from "./WindowBar";

describe("WindowBar", () => {
  it("describes the window and the current year", () => {
    render(<WindowBar from={2024} to={2030} current={2026} />);
    expect(
      screen.getByRole("img", { name: "Drinking window 2024–2030, now 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
    expect(screen.getByText("2030")).toBeInTheDocument();
  });

  it("handles an open-ended window", () => {
    render(<WindowBar from={2028} current={2026} />);
    expect(
      screen.getByRole("img", { name: "Drinking window from 2028, now 2026" }),
    ).toBeInTheDocument();
  });

  it("says when no window is set", () => {
    render(<WindowBar current={2026} />);
    expect(screen.getByText("No drinking window yet")).toBeInTheDocument();
  });

  it("tones the bar by status", () => {
    const { rerender } = render(<WindowBar from={2028} to={2035} current={2026} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-status", "hold");
    rerender(<WindowBar from={2015} to={2020} current={2026} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-status", "past-peak");
    rerender(<WindowBar from={2020} to={2027} current={2026} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-status", "drink-soon");
    rerender(<WindowBar from={2020} to={2032} current={2026} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-status", "ready");
  });
});
