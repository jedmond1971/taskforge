// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PropertyRow } from "../property-row";

describe("PropertyRow", () => {
  it("renders the label and its children", () => {
    render(
      <PropertyRow label="Status">
        <select defaultValue="OPEN">
          <option value="OPEN">Open</option>
        </select>
      </PropertyRow>
    );
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
