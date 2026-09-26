import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { routes } from "./routes";

describe("App shell", () => {
  it("renders the Vintry header and a main landmark", async () => {
    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Vintry" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
