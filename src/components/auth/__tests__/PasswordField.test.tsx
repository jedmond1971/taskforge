// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordField } from "../PasswordField";

describe("PasswordField (JFR-183)", () => {
  it("starts hidden and toggles visibility, with an accurate label and pressed state", () => {
    render(<PasswordField id="pw" name="password" label="Password" autoComplete="current-password" />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("type")).toBe("button"); // must never submit the form

    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(hide);
    expect(input.type).toBe("password");
  });

  it("keeps what was typed when toggled", () => {
    render(<PasswordField id="pw" name="password" label="Password" autoComplete="current-password" />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.value).toBe("hunter2hunter2");
  });

  it.each(["current-password", "new-password"] as const)("passes autocomplete=%s through for password managers", (autoComplete) => {
    render(<PasswordField id="pw" name="password" label="Password" autoComplete={autoComplete} />);
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe(autoComplete);
  });

  it("is required, named for FormData, and opts out of spellcheck/autocorrect", () => {
    render(<PasswordField id="pw" name="password" label="Password" autoComplete="new-password" minLength={8} />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.name).toBe("password");
    expect(input.minLength).toBe(8);
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autocorrect")).toBe("off");
  });

  it("renders the label-row aside (the forgot-password link slot)", () => {
    render(
      <PasswordField id="pw" name="password" label="Password" autoComplete="current-password" labelAside={<a href="/forgot-password">Forgot?</a>} />
    );
    expect(screen.getByRole("link", { name: "Forgot?" }).getAttribute("href")).toBe("/forgot-password");
  });
});
