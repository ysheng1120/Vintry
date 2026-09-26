import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AiStatus } from "../../ai/useAiStatus";
import { MappingEditor } from "./MappingEditor";

let aiStatus: AiStatus = { state: "no-key" };
vi.mock("../../ai/useAiStatus", () => ({ useAiStatus: () => aiStatus }));

const HEADERS = ["Producer", "Wine", "Vintage"];

describe("MappingEditor", () => {
  it("shows a header select for every Vintry field", () => {
    render(
      <MappingEditor
        headers={HEADERS}
        source="cellartracker"
        mapping={{ producer: "Producer" }}
        onChange={vi.fn()}
      />,
    );
    const producerSelect = screen.getByLabelText(/^Producer/) as HTMLSelectElement;
    expect(producerSelect.value).toBe("Producer");
    expect(screen.getByLabelText("Cuvée / wine name")).toBeInTheDocument();
    expect(screen.getByText("Detected format:")).toBeInTheDocument();
    expect(screen.getByText("CellarTracker")).toBeInTheDocument();
  });

  it("calls onChange with the field mapped to the chosen header", async () => {
    const onChange = vi.fn();
    render(
      <MappingEditor headers={HEADERS} source="cellartracker" mapping={{}} onChange={onChange} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/^Producer/), "Producer");
    expect(onChange).toHaveBeenCalledWith({ producer: "Producer" });
  });

  it("clears a field when 'Not in this file' is chosen", async () => {
    const onChange = vi.fn();
    render(
      <MappingEditor
        headers={HEADERS}
        source="cellartracker"
        mapping={{ producer: "Producer" }}
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/^Producer/), "Not in this file");
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("hides the AI suggestion button when the source is not generic", () => {
    aiStatus = { state: "ready" };
    render(
      <MappingEditor
        headers={HEADERS}
        source="cellartracker"
        mapping={{}}
        onChange={vi.fn()}
        onSuggest={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Suggest with AI" })).not.toBeInTheDocument();
  });

  it("hides the AI suggestion button when there is no key", () => {
    aiStatus = { state: "no-key" };
    render(
      <MappingEditor
        headers={HEADERS}
        source="generic"
        mapping={{}}
        onChange={vi.fn()}
        onSuggest={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Suggest with AI" })).not.toBeInTheDocument();
  });

  it("shows the AI suggestion button for a generic file once AI is ready", async () => {
    aiStatus = { state: "ready" };
    const onSuggest = vi.fn();
    render(
      <MappingEditor
        headers={HEADERS}
        source="generic"
        mapping={{}}
        onChange={vi.fn()}
        onSuggest={onSuggest}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });

  it("shows the suggestion's plain-language notes", () => {
    aiStatus = { state: "ready" };
    render(
      <MappingEditor
        headers={HEADERS}
        source="generic"
        mapping={{}}
        onChange={vi.fn()}
        onSuggest={vi.fn()}
        suggestionNotes={["Colour column uses 'Rouge' for red"]}
      />,
    );
    expect(screen.getByText("Colour column uses 'Rouge' for red")).toBeInTheDocument();
  });

  it("shows a suggestion error in plain language", () => {
    aiStatus = { state: "ready" };
    render(
      <MappingEditor
        headers={HEADERS}
        source="generic"
        mapping={{}}
        onChange={vi.fn()}
        onSuggest={vi.fn()}
        suggestionError="AI mapping is not available yet."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("AI mapping is not available yet.");
  });
});
