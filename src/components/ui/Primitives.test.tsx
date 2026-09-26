import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge";
import { Card } from "./Card";
import { Chip, FilterChip } from "./Chip";
import { ColorDot } from "./ColorDot";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { Skeleton } from "./Skeleton";

describe("Badge", () => {
  it("renders its text and tone", () => {
    render(<Badge tone="ready">Ready</Badge>);
    expect(screen.getByText("Ready")).toHaveAttribute("data-tone", "ready");
  });
});

describe("Card", () => {
  it("renders children in a surface", () => {
    render(<Card>Inside</Card>);
    expect(screen.getByText("Inside")).toBeInTheDocument();
  });
});

describe("Chip and FilterChip", () => {
  it("removes a chip with its remove button", async () => {
    const onRemove = vi.fn();
    render(<Chip onRemove={onRemove}>Bordeaux</Chip>);
    await userEvent.click(screen.getByRole("button", { name: "Remove Bordeaux" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("toggles a filter chip and exposes its pressed state", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FilterChip selected={false} onToggle={onToggle} count={12}>
        Red
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: /Red/ });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveTextContent("12");
    await userEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith(true);
    rerender(
      <FilterChip selected onToggle={onToggle}>
        Red
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: /Red/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ColorDot", () => {
  it("names the wine colour for assistive tech", () => {
    render(<ColorDot color="rose" />);
    expect(screen.getByRole("img", { name: "Rosé" })).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows a title, description, and action", () => {
    render(
      <EmptyState
        title="No wines yet"
        description="Add your first bottle."
        action={<button type="button">Add wine</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No wines yet" })).toBeInTheDocument();
    expect(screen.getByText("Add your first bottle.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add wine" })).toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("PageHeader", () => {
  it("renders the page title as the H1 with subtitle, actions, and back link", () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Cellar"
          subtitle="42 bottles"
          actions={<button type="button">Export</button>}
          back={{ to: "/", label: "Home" }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Cellar" })).toBeInTheDocument();
    expect(screen.getByText("42 bottles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Home/ })).toHaveAttribute("href", "/");
  });
});
