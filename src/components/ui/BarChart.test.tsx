import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarChart } from "./BarChart";

const data = [
  { key: "red", label: "Red", value: 20 },
  { key: "white", label: "White", value: 10 },
  { key: "rose", label: "Rosé", value: 0 },
];

describe("BarChart", () => {
  it("summarises every bar in one accessible name", () => {
    render(<BarChart title="Bottles by colour" data={data} />);
    expect(
      screen.getByRole("img", { name: "Bottles by colour: Red 20, White 10, Rosé 0" }),
    ).toBeInTheDocument();
  });

  it("gives a hidden table with a row per category, for screen readers", () => {
    render(<BarChart title="Bottles by colour" data={data} />);
    const table = screen.getByRole("table", { hidden: true });
    expect(table).toHaveClass("sr-only");
    expect(within(table).getByText("Red")).toBeInTheDocument();
    expect(within(table).getByText("20")).toBeInTheDocument();
    expect(within(table).getByText("White")).toBeInTheDocument();
  });

  it("scales bar width with value and floors zero-value bars at width 0", () => {
    render(<BarChart title="Bottles by colour" data={data} />);
    const rects = document.querySelectorAll("rect");
    expect(rects).toHaveLength(3);
    const widths = Array.from(rects, (r) => Number(r.getAttribute("width")));
    expect(widths[0]).toBeGreaterThan(widths[1]!);
    expect(widths[2]).toBe(0);
  });

  it("uses a per-bar fill class when given, else the default", () => {
    render(
      <BarChart
        title="Bottles by colour"
        data={[{ key: "red", label: "Red", value: 5, className: "fill-wine-red" }]}
        barClassName="fill-primary"
      />,
    );
    expect(document.querySelector("rect")).toHaveClass("fill-wine-red");
  });

  it("falls back to a message when there is nothing to plot", () => {
    render(<BarChart title="Bottles by colour" data={[]} emptyMessage="No bottles yet." />);
    expect(screen.getByText("No bottles yet.")).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("formats values with the given formatter", () => {
    render(
      <BarChart
        title="Bottles by colour"
        data={[{ key: "red", label: "Red", value: 5 }]}
        formatValue={(v) => `${v} bottles`}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Bottles by colour: Red 5 bottles" }),
    ).toBeInTheDocument();
  });
});
