// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClinicNav } from "./clinic-nav";

describe("ClinicNav", () => {
  it("links to the four clinic screens and posts sign-out", () => {
    render(<ClinicNav />);
    const nav = screen.getByRole("navigation", { name: "Clinic" });
    for (const [name, href] of [
      ["Patients", "/patients"],
      ["Queue", "/queue"],
      ["Audit", "/audit"],
      ["Windows", "/windows"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form")!;
    expect(nav).toContainElement(form);
    expect(form).toHaveAttribute("action", "/login/sign-out");
    expect(form).toHaveAttribute("method", "post");
  });
});
