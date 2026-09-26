import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import { fakeApiError, installFakeAi, uninstallFakeAi, type FakeAi } from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { resetDatabase } from "../../db/testing";
import TidyNoteButton from "./TidyNoteButton";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

/** A note editor like NoteSheet's: the tidy note fills the text box for the user to edit. */
function Editor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return (
    <ToastProvider>
      <label>
        Note
        <textarea value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <TidyNoteButton text={text} onResult={setText} />
    </ToastProvider>
  );
}

describe("TidyNoteButton", () => {
  it("is hidden when there is no key", async () => {
    render(<Editor initial="cherry cedar" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("button", { name: /Tidy/ })).not.toBeInTheDocument();
  });

  it("fills the editor with the tidy note, which stays editable", async () => {
    await saveApiKey("sk-ant-test");
    ai.queueJson({ note: "Dark cherry and cedar. Firm tannins." });
    const user = userEvent.setup();
    render(<Editor initial="cherry cedar tannic" />);

    await user.click(await screen.findByRole("button", { name: "Tidy with AI" }));

    const box = screen.getByLabelText("Note");
    expect(await screen.findByDisplayValue("Dark cherry and cedar. Firm tannins.")).toBe(box);
    await user.type(box, " Lovely.");
    expect(box).toHaveValue("Dark cherry and cedar. Firm tannins. Lovely.");
  });

  it("is disabled until there is some text", async () => {
    await saveApiKey("sk-ant-test");
    render(<Editor initial="  " />);
    expect(await screen.findByRole("button", { name: "Tidy with AI" })).toBeDisabled();
  });

  it("keeps the note and explains the error when the request fails", async () => {
    await saveApiKey("sk-ant-test");
    ai.queueError(fakeApiError(429, "rate_limit_error", "slow down"));
    const user = userEvent.setup();
    render(<Editor initial="cherry cedar" />);

    await user.click(await screen.findByRole("button", { name: "Tidy with AI" }));

    const toasts = within(screen.getByRole("region", { name: "Notifications" }));
    expect(await toasts.findByText(/Too many requests/)).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toHaveValue("cherry cedar");
  });
});
