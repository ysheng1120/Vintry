import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";
import { Stepper } from "./Stepper";

function Harness({
  initial = 1,
  min = 0,
  max = 99,
}: {
  initial?: number;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Field label="Bottles">
      <Stepper value={value} onChange={setValue} min={min} max={max} />
    </Field>
  );
}

describe("Stepper", () => {
  it("increments and decrements with the buttons", async () => {
    render(<Harness initial={2} />);
    const input = screen.getByRole("spinbutton", { name: "Bottles" });
    await userEvent.click(screen.getByRole("button", { name: "Increase Bottles" }));
    expect(input).toHaveValue(3);
    await userEvent.click(screen.getByRole("button", { name: "Decrease Bottles" }));
    await userEvent.click(screen.getByRole("button", { name: "Decrease Bottles" }));
    expect(input).toHaveValue(1);
  });

  it("disables decrease at the minimum and increase at the maximum", () => {
    render(<Harness initial={1} min={1} max={1} />);
    expect(screen.getByRole("button", { name: "Decrease Bottles" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase Bottles" })).toBeDisabled();
  });

  it("accepts typed numbers and clamps them on blur", async () => {
    render(<Harness initial={1} max={12} />);
    const input = screen.getByRole("spinbutton", { name: "Bottles" });
    await userEvent.clear(input);
    await userEvent.type(input, "40");
    await userEvent.tab();
    expect(input).toHaveValue(12);
  });
});
