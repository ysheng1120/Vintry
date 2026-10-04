import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLiveQuery } from "dexie-react-hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveApiKey } from "../../ai/client";
import {
  fakeApiError,
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
import type { Wine, WineCritics } from "../../domain/types";
import CriticsSection from "./CriticsSection";

let ai: FakeAi;

beforeEach(async () => {
  await resetDatabase();
  setClock("2026-09-26T12:00:00Z");
  ai = installFakeAi();
});

afterEach(() => {
  uninstallFakeAi();
});

const JANCIS = "https://www.jancisrobinson.com/tasting-notes/ridge-monte-bello-2019";
const DECANTER = "https://www.decanter.com/wine-reviews/ridge-monte-bello-2019";

async function addWine(overrides: Partial<Wine> = {}): Promise<Wine> {
  const wine = makeWine(overrides);
  await db.wines.add(wine);
  return wine;
}

/** Renders the card from the live row, as the wine page does. */
function LiveCard({ id }: { id: string }) {
  const wine = useLiveQuery(() => db.wines.get(id), [id]);
  return wine ? <CriticsSection wine={wine} /> : null;
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

function queueResearch() {
  ai.queueResponse({
    content: [
      ...fakeWebSearch("srv_1", "Ridge Monte Bello 2019 review", [
        { url: JANCIS, title: "Ridge Monte Bello 2019 | JancisRobinson.com" },
        { url: DECANTER, title: "Ridge, Monte Bello 2019 - Decanter" },
      ]),
      fakeCitedText("Jancis Robinson gives it 17.5/20.", [
        { url: JANCIS, title: "JancisRobinson.com", citedText: "Long, cool and savoury. 17.5/20" },
      ]),
      fakeCitedText(" Decanter finds it fresh.", [
        { url: DECANTER, title: "Decanter", citedText: "A fresh, finely built Monte Bello." },
      ]),
    ],
  });
}

const SUMMARY = {
  consensus: "Critics agree the 2019 is fresh and long, built for the cellar.",
  points: [
    { text: "Long, cool and savoury", sourceIds: [1] },
    { text: "Fresh and finely built", sourceIds: [2] },
  ],
  scores: [
    {
      critic: "Jancis Robinson",
      publication: "JancisRobinson.com",
      score: "17.5",
      scale: "20",
      sourceId: 1,
    },
  ],
  found: true,
};

const SAVED: WineCritics = {
  consensus: "Critics like it.",
  points: [
    { text: "Fresh", sources: [{ url: DECANTER, title: "Decanter" }] },
    { text: "Sneaky", sources: [{ url: "javascript:alert(1)", title: "Bad" }] },
  ],
  scores: [
    {
      critic: "Jancis Robinson",
      publication: "",
      score: "17.5",
      scale: "20",
      source: { url: "data:text/html,hi", title: "Bad" },
    },
  ],
  found: true,
  generatedAt: "2026-09-20T12:00:00.000Z",
  model: "claude-opus-5",
};

/** Two requests and a save run after a click; allow for a busy test machine. */
const SLOW = { timeout: 5000 };

/** The Find button once the saved key has loaded (it is disabled until then). */
async function findButton() {
  const button = await screen.findByRole("button", { name: "Find what others say" });
  await waitFor(() => expect(button).toBeEnabled(), SLOW);
  return button;
}

const toasts = () => within(screen.getByRole("region", { name: "Notifications" }));

describe("CriticsSection (What others say)", () => {
  it("shows a disabled button titled Needs AI key, and the note, when there is no key", async () => {
    const wine = await addWine();
    renderCard(wine);
    expect(
      await screen.findByRole("heading", { level: 3, name: "What others (excl. Parker) say" }),
    ).toBeVisible();
    const button = await screen.findByRole("button", { name: "Find what others say" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Needs AI key");
    expect(
      screen.getByText("Searches reputable wine sites. Uses your AI key (a few web searches)."),
    ).toBeInTheDocument();
  });

  it("finds what critics say and shows the sourced summary with a verified score", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson(SUMMARY);
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(await toasts().findByText(/Found what others say/, {}, SLOW)).toBeInTheDocument();
    expect(toasts().getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(await screen.findByText(SUMMARY.consensus)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Scores" })).toBeVisible();
    const score = screen.getByText(/Jancis Robinson: 17\.5\/20/);
    expect(score).toHaveTextContent("(JancisRobinson.com)");
    const scoreLink = within(score).getByRole("link", { name: /^Source:/ });
    expect(scoreLink).toHaveAttribute("href", JANCIS);
    expect(scoreLink).toHaveAttribute("target", "_blank");
    expect(scoreLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Long, cool and savoury")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Source 1:/ })).toHaveAttribute("href", JANCIS);
    expect(screen.getByRole("link", { name: /^Source 2:/ })).toHaveAttribute("href", DECANTER);
    expect(screen.getByText(/Researched by AI on/)).toHaveTextContent(
      "Scores are shown only when the source shows them. Check the linked reviews.",
    );
    expect(screen.getByRole("button", { name: "Refresh critics summary" })).toBeInTheDocument();
    expect(ai.requests).toHaveLength(2);
  });

  it("drops a score the cited text does not show", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson({
      ...SUMMARY,
      scores: [{ ...SUMMARY.scores[0], score: "18.5" }],
    });
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(await screen.findByText(SUMMARY.consensus, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText(/18\.5/)).not.toBeInTheDocument();
    expect(screen.queryByText("Scores")).not.toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.critics?.scores).toEqual([]);
  });

  it("says no reviews were found when nothing can be verified", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson({ ...SUMMARY, points: [{ text: "Invented", sourceIds: [7] }], scores: [] });
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(
      await screen.findByText("No public critic reviews found for this vintage.", {}, SLOW),
    ).toBeInTheDocument();
    expect(toasts().getByText(/No critic reviews found/)).toBeInTheDocument();
    expect(screen.queryByText("Invented")).not.toBeInTheDocument();
  });

  it("sends one request per step even on a double click", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    queueResearch();
    ai.queueJson(SUMMARY);
    const user = renderCard(wine);

    await user.dblClick(await findButton());

    expect(await screen.findByText(SUMMARY.consensus, {}, SLOW)).toBeInTheDocument();
    expect(ai.requests).toHaveLength(2);
    expect(ai.requests[0]?.tools).toBeDefined();
    expect(ai.requests[1]?.tools).toBeUndefined();
  });

  it("links only http(s) sources", async () => {
    const wine = await addWine({ critics: SAVED });
    renderCard(wine);

    expect(await screen.findByText("Critics like it.")).toBeInTheDocument();
    expect(screen.getByText(/Jancis Robinson: 17\.5\/20/)).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", DECANTER);
    expect(links[0]).toHaveTextContent("[1]");
  });

  it("hides Robert Parker in a summary saved before he was left out", async () => {
    const withParker: WineCritics = {
      ...SAVED,
      consensus: "Critics like it. Parker called it a classic.",
      points: [
        ...SAVED.points,
        { text: "Parker loved it", sources: [{ url: DECANTER, title: "Decanter" }] },
      ],
      scores: [
        ...SAVED.scores,
        {
          critic: "Robert Parker",
          publication: "",
          score: "98",
          scale: "100",
          source: { url: DECANTER, title: "Decanter" },
        },
      ],
    };
    const wine = await addWine({ critics: withParker });
    renderCard(wine);

    expect(await screen.findByText("Critics like it.")).toBeInTheDocument();
    for (const text of [/called it a classic/, /Parker loved it/, /Robert Parker/]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/Jancis Robinson: 17\.5\/20/)).toBeInTheDocument();
  });

  it("removes the summary and Undo brings it back", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine({ critics: SAVED });
    const user = renderCard(wine);

    const remove = await screen.findByRole("button", { name: "Remove critics summary" });
    await waitFor(() => expect(remove).toBeEnabled(), SLOW);
    await user.click(remove);

    expect(await toasts().findByText(/Removed what others say/, {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Find what others say" })).toBeEnabled();
    expect((await db.wines.get(wine.id))?.critics).toBeNull();

    await user.click(toasts().getByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Critics like it.", {}, SLOW)).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.critics).toEqual(SAVED);
  });

  it("keeps nothing and explains the error when the request fails", async () => {
    await saveApiKey("sk-ant-test");
    const wine = await addWine();
    ai.queueError(fakeApiError(429, "rate_limit_error", "slow down"));
    const user = renderCard(wine);

    await user.click(await findButton());

    expect(await toasts().findByText(/Too many requests/, {}, SLOW)).toBeInTheDocument();
    expect(toasts().getByText("Couldn't find what others say")).toBeInTheDocument();
    expect((await db.wines.get(wine.id))?.critics).toBeUndefined();
    expect(screen.getByRole("button", { name: "Find what others say" })).toBeEnabled();
  });
});
