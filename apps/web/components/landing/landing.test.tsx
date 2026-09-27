// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/(entry)/page";

describe("landing page", () => {
  it("falls back to a static story without WebGL and keeps both calls to action", async () => {
    render(<Home />);
    // jsdom has no WebGL, so the static story replaces the 3D stage after mount.
    expect(await screen.findByRole("heading", { level: 1, name: "Take your iPLEDGE test at home." })).toBeInTheDocument();
    const signIn = screen.getAllByRole("link", { name: "Sign in as a clinician" });
    expect(signIn[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "See how it works" })[0]).toHaveAttribute("href", "#how");
    const patient = screen.getAllByRole("link", { name: "Patient sign in" });
    expect(patient.length).toBeGreaterThanOrEqual(2);
    for (const link of patient) expect(link).toHaveAttribute("href", "/portal/login");
    expect(screen.getByRole("link", { name: "Clinician sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("heading", { name: /one-time link/i })).toBeInTheDocument();
  });

  it("credits the team and never shows a test result", () => {
    const { container } = render(<Home />);
    expect(screen.getByText("Built at HackGT 13 by Labib, Adrit and Nihalika.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b(positive|negative)\b/i);
  });
});
