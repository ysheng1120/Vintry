import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// findBy / waitFor wait up to 1 s by default, too short when the machine is busy.
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
});
