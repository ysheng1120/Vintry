import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs } from "./Tabs";

const items = [
  { id: "lots", label: "Bottles", content: <p>Lots here</p> },
  { id: "notes", label: "Notes", content: <p>Notes here</p> },
  { id: "history", label: "History", content: <p>History here</p> },
];

describe("Tabs", () => {
  it("shows the selected panel and switches on click", async () => {
    render(<Tabs label="Wine sections" items={items} />);
    expect(screen.getByRole("tablist", { name: "Wine sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Bottles" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Bottles" })).toHaveTextContent("Lots here");
    await userEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(screen.getByRole("tabpanel", { name: "Notes" })).toHaveTextContent("Notes here");
  });

  it("moves between tabs with arrow keys", async () => {
    render(<Tabs label="Wine sections" items={items} />);
    screen.getByRole("tab", { name: "Bottles" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Notes" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Notes" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
  });
});
