import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveApiKey } from "../../ai/client";
import { resetDatabase } from "../../db/testing";
import AddHubPage from "./AddHub";

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

function renderHub() {
  render(
    <MemoryRouter>
      <AddHubPage />
    </MemoryRouter>,
  );
}

const tile = (name: RegExp) => screen.getByRole("link", { name });

describe("Add hub", () => {
  it("keeps the four ways to add and marks the AI ones when there is no key", async () => {
    renderHub();
    expect(await screen.findAllByText("Needs AI key")).toHaveLength(2);
    expect(tile(/Scan a label/)).toHaveAttribute("href", "/add/scan");
    expect(tile(/Describe it/)).toHaveAttribute("href", "/add/describe");
    expect(within(tile(/Scan a label/)).getByText("Needs AI key")).toBeInTheDocument();
    expect(within(tile(/Add by hand/)).queryByText("Needs AI key")).not.toBeInTheDocument();
    expect(tile(/Import a file/)).toHaveAttribute("href", "/import");
  });

  it("shows no note when AI is ready", async () => {
    await saveApiKey("sk-ant-test");
    renderHub();
    await waitFor(() => expect(screen.queryByText("Needs AI key")).not.toBeInTheDocument());
    expect(tile(/Scan a label/)).toHaveAttribute("href", "/add/scan");
  });

  it("says you are offline on the AI tiles", async () => {
    await saveApiKey("sk-ant-test");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderHub();
    expect(await screen.findAllByText("You are offline")).toHaveLength(2);
  });
});
