import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./Field";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("Field", () => {
  it("labels its control and links the hint through aria-describedby", () => {
    render(
      <Field label="Producer" hint="As printed on the label">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Producer" });
    expect(input).toHaveAccessibleDescription("As printed on the label");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("shows an error, marks the control invalid, and describes it with the error", () => {
    render(
      <Field label="Vintage" hint="Four digits" error="Enter a year like 2019">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Vintage" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Enter a year like 2019/);
    expect(input).toHaveAccessibleDescription(/Four digits/);
  });

  it("marks required fields", () => {
    render(
      <Field label="Name" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: /Name/ })).toBeRequired();
  });

  it("works with Textarea and Select", async () => {
    const onChange = vi.fn();
    render(
      <>
        <Field label="Notes">
          <Textarea />
        </Field>
        <Field label="Colour">
          <Select onChange={(e) => onChange(e.target.value)}>
            <option value="red">Red</option>
            <option value="white">White</option>
          </Select>
        </Field>
      </>,
    );
    expect(screen.getByRole("textbox", { name: "Notes" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Colour" }), "white");
    expect(onChange).toHaveBeenCalledWith("white");
  });
});
