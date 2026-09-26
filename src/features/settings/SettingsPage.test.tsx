import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiKeyHint, saveApiKey } from "../../ai/client";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { recordUsage } from "../../ai/usage";
import { ToastProvider } from "../../components/ui/Toast";
import { getSetting } from "../../db/settings";
import { resetDatabase } from "../../db/testing";
import SettingsPage from ".";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("Settings page: AI key", () => {
  it("shows the no-key state and a link to get a key", async () => {
    renderPage();
    expect(await screen.findByText(/No key yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How to get a key" })).toHaveAttribute(
      "href",
      "/help#ai-key",
    );
    expect(
      screen.getByText(/send the text, photo, or cellar details they use to Anthropic/),
    ).toBeInTheDocument();
  });

  it("masks the key field and can show it", async () => {
    const user = userEvent.setup();
    renderPage();
    const field = screen.getByLabelText("Claude API key");
    expect(field).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show key" }));
    expect(field).toHaveAttribute("type", "text");
  });

  it("saves and tests a key, then shows that AI is ready", async () => {
    const user = userEvent.setup();
    ai.queueText("OK");
    renderPage();
    await user.type(screen.getByLabelText("Claude API key"), "sk-ant-api03-goodWXYZ");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByText("Your key works.")).toBeInTheDocument();
    expect(await apiKeyHint()).toBe("…WXYZ");
    expect(await screen.findByText(/AI is ready/)).toBeInTheDocument();
    expect(screen.getByText(/Saved key ending in …WXYZ/)).toBeInTheDocument();
  });

  it("explains a rejected key in plain words", async () => {
    const user = userEvent.setup();
    ai.queueError(fakeApiError(401, "authentication_error", "invalid x-api-key"));
    renderPage();
    await user.type(screen.getByLabelText("Claude API key"), "sk-ant-typo");
    await user.click(screen.getByRole("button", { name: "Test key" }));
    expect(
      await screen.findByText("That key was not accepted. Check it was copied fully."),
    ).toBeInTheDocument();
    // Testing a key that is not saved does not save it.
    expect(await apiKeyHint()).toBeNull();
  });

  it("removes the key after confirming", async () => {
    const user = userEvent.setup();
    await saveApiKey("sk-ant-api03-goodWXYZ");
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove key" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove key" }));
    await waitFor(async () => expect(await apiKeyHint()).toBeNull());
    expect(await screen.findByText(/No key yet/)).toBeInTheDocument();
  });
});

describe("Settings page: model", () => {
  it("shows each model with the cost of one label scan and saves the choice", async () => {
    const user = userEvent.setup();
    renderPage();
    const best = screen.getByRole("radio", { name: /Best \(Claude Opus 5\)/ });
    expect(best).toBeChecked();
    expect(screen.getByText(/about \$0\.023 per label scan/i)).toBeInTheDocument();
    expect(screen.getByText(/about \$0\.009 per label scan/i)).toBeInTheDocument();
    expect(screen.getByText(/about \$0\.0045 per label scan/i)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Economy \(Claude Haiku 4\.5\)/ }));
    await waitFor(async () => expect(await getSetting("model", null)).toBe("claude-haiku-4-5"));
  });
});

describe("Settings page: usage", () => {
  it("shows this month's and all-time usage by feature", async () => {
    await recordUsage({
      feature: "scan",
      model: "claude-opus-5",
      inputTokens: 1000,
      outputTokens: 500,
    });
    await recordUsage({
      feature: "chat",
      model: "claude-mystery",
      inputTokens: 10,
      outputTokens: 5,
    });
    renderPage();
    const usage = await screen.findByRole("region", { name: "Usage" });
    const month = await within(usage).findByRole("table", { name: "This month" });
    expect(within(month).getByRole("row", { name: /Label scan/ })).toHaveTextContent("$0.018");
    expect(within(month).getByRole("row", { name: /Sommelier/ })).toHaveTextContent(
      "price unknown",
    );
    expect(within(usage).getByRole("table", { name: "All time" })).toBeInTheDocument();
  });

  it("says there is no usage yet", async () => {
    renderPage();
    expect(await screen.findByText("No AI requests yet.")).toBeInTheDocument();
  });
});

describe("Settings page: preferences and links", () => {
  it("saves the currency and theme", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await waitFor(async () => expect(await getSetting("currency", null)).toBe("EUR"));
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(async () => expect(await getSetting("theme", null)).toBe("dark"));
  });

  it("links to Backup, What's new, and Help", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /Backup/ })).toHaveAttribute("href", "/backup");
    expect(screen.getByRole("link", { name: /What's new/ })).toHaveAttribute("href", "/whats-new");
    expect(screen.getByRole("link", { name: /^Help/ })).toHaveAttribute("href", "/help");
  });
});
