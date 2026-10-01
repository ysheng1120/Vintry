import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLiveQuery } from "dexie-react-hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import {
  fakeCitedText,
  fakeWebSearch,
  installFakeAi,
  uninstallFakeAi,
  type FakeAi,
} from "../../ai/fake";
import { ToastProvider } from "../../components/ui/Toast";
import { db } from "../../db/db";
import { makeWine, resetDatabase } from "../../db/testing";
import { setClock } from "../../domain/clock";
import type { Wine } from "../../domain/types";
import WineGuideCard from "./WineGuideCard";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-10-01T12:00:00Z");
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

const JANCIS = "https://www.jancisrobinson.com/tasting-notes/ridge-monte-bello-2019";

const PROFILE = {
  summary: "Ridge makes structured, age-worthy reds from the Santa Cruz Mountains.",
  tasting: "Typically shows blackcurrant and cedar, with firm tannins.",
  pairings: ["Roast lamb", "Aged cheddar"],
  serving: "Serve at 16 to 18°C.",
};

const SAVED_PROFILE = { ...PROFILE, generatedAt: "2026-09-20T12:00:00.000Z", model: "m" };

const SAVED_CRITICS = {
  consensus: "Critics like it.",
  points: [{ text: "Fresh", sources: [{ url: JANCIS, title: "Jancis" }] }],
  scores: [
    {
      critic: "Jancis Robinson",
      publication: "",
      score: "17.5",
      scale: "20",
      source: { url: JANCIS, title: "Jancis" },
    },
  ],
  found: true,
  generatedAt: "2026-09-20T12:00:00.000Z",
  model: "m",
};

async function addWine(overrides: Partial<Wine> = {}): Promise<Wine> {
  const wine = makeWine(overrides);
  await db.wines.add(wine);
  return wine;
}

/** Renders the card from the live row, as the wine page does. */
function LiveCard({ id }: { id: string }) {
  const wine = useLiveQuery(() => db.wines.get(id), [id]);
  return wine ? <WineGuideCard key={wine.id} wine={wine} /> : null;
}

function renderCard(wine: Wine) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <LiveCard id={wine.id} />
    </ToastProvider>,
  );
  return user;
}

const SLOW = { timeout: 5000 };
const toasts = () => within(screen.getByRole("region", { name: "Notifications" }));

async function enabledButton(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled(), SLOW);
  return button;
}

describe("WineGuideCard", () => {
  it("has one h2, three h3 sections, h4 subheadings, and the AI note once", async () => {
    const wine = await addWine({ profile: SAVED_PROFILE, critics: SAVED_CRITICS });
    renderCard(wine);

    expect(await screen.findByRole("heading", { level: 2, name: "About this wine" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Profile",
      "What critics say",
      "Shop prices",
    ]);
    expect(screen.getByRole("heading", { level: 4, name: "Pairs well with" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 4, name: "Scores" })).toBeVisible();
    expect(screen.getAllByText("Needs AI key")).toHaveLength(1);
  });

  it("disables all three actions without a key", async () => {
    const wine = await addWine();
    renderCard(wine);

    for (const name of ["Write a profile", "Find what critics say", "Check price"]) {
      const button = await screen.findByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Needs AI key");
    }
    expect(screen.getAllByText("Needs AI key")).toHaveLength(1);
  });

  it("gives each section's actions distinct names", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine({ profile: SAVED_PROFILE, critics: SAVED_CRITICS });
    renderCard(wine);

    for (const name of [
      "Rewrite profile",
      "Remove profile",
      "Refresh critics summary",
      "Remove critics summary",
      "Check price",
    ]) {
      expect(await screen.findAllByRole("button", { name })).toHaveLength(1);
    }
    expect(screen.queryByText("Needs AI key")).not.toBeInTheDocument();
  });

  it("writes a profile, removes it, and Undo brings it back inside the card", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueJson(PROFILE);
    const user = renderCard(wine);

    await user.click(await enabledButton("Write a profile"));
    expect(await screen.findByText(PROFILE.summary, {}, SLOW)).toBeInTheDocument();

    await user.click(await enabledButton("Remove profile"));
    expect(await toasts().findByText(/Removed the profile/, {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Write a profile" })).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.profile).toBeNull();

    const undo = toasts().getAllByRole("button", { name: "Undo" }).at(-1)!;
    await user.click(undo);
    expect(await screen.findByText(PROFILE.summary, {}, SLOW)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.profile).toMatchObject(PROFILE);
  });

  it("finds what critics say inside the card, showing a verified score", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueResponse({
      content: [
        ...fakeWebSearch("srv_1", "Ridge Monte Bello 2019 review", [
          { url: JANCIS, title: "Ridge Monte Bello 2019 | JancisRobinson.com" },
        ]),
        fakeCitedText("Jancis Robinson gives it 17.5/20.", [
          { url: JANCIS, title: "JancisRobinson.com", citedText: "Long and savoury. 17.5/20" },
        ]),
      ],
    });
    ai.queueJson({
      consensus: "Critics find it long and savoury.",
      points: [{ text: "Long and savoury", sourceIds: [1] }],
      scores: [
        { critic: "Jancis Robinson", publication: "", score: "17.5", scale: "20", sourceId: 1 },
        { critic: "Someone Else", publication: "", score: "99", scale: "100", sourceId: 1 },
      ],
      found: true,
    });
    const user = renderCard(wine);

    await user.click(await enabledButton("Find what critics say"));

    expect(
      await screen.findByText("Critics find it long and savoury.", {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByText(/Jancis Robinson: 17\.5\/20/)).toBeInTheDocument();
    expect(screen.queryByText(/99\/100/)).not.toBeInTheDocument();
  });
});
