// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClinicNav } from "./clinic-nav";

describe("ClinicNav", () => {
  it("shows a prescriber every clinic screen and posts sign-out", () => {
    render(<ClinicNav role="prescriber" />);
    const nav = screen.getByRole("navigation", { name: "Clinic" });
    for (const [name, href] of [
      ["Requests", "/requests"],
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

  it("hides the review queue from staff", () => {
    render(<ClinicNav role="staff" />);
    for (const name of ["Requests", "Patients", "Windows", "Audit"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: "Queue" })).not.toBeInTheDocument();
  });

  it("with the role unknown, shows only what every clinician may see", () => {
    render(<ClinicNav />);
    expect(screen.getByRole("link", { name: "Requests" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Queue" })).not.toBeInTheDocument();
  });
});
