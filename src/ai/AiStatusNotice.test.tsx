import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AiStatusNotice } from "./AiStatusNotice";

function renderNotice(status: Parameters<typeof AiStatusNotice>[0]["status"]) {
  return render(
    <MemoryRouter>
      <AiStatusNotice status={status} manual={{ to: "/add/manual", label: "Add by hand" }} />
    </MemoryRouter>,
  );
}

describe("AiStatusNotice", () => {
  it("explains how to add a key and offers the manual path when there is no key", () => {
    renderNotice({ state: "no-key" });
    expect(screen.getByText("AI needs your Claude API key")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a key in Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByRole("link", { name: "Add by hand" })).toHaveAttribute(
      "href",
      "/add/manual",
    );
  });

  it("gives the plain reason when AI is unavailable", () => {
    renderNotice({
      state: "unavailable",
      reason: "You are offline. AI features need an internet connection.",
    });
    expect(screen.getByText("AI is unavailable right now")).toBeInTheDocument();
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add by hand" })).toBeInTheDocument();
  });

  it("renders nothing when AI is ready", () => {
    const { container } = renderNotice({ state: "ready" });
    expect(container).toBeEmptyDOMElement();
  });
});
