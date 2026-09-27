"use client";

// Shown on every page while any endpoint answers from the mock adapter, so mock data is never
// mistaken for real data. Also lets a reviewer jump the portal to any cycle state and preview
// the staff or prescriber view. Rendered only when lib/api/mode says mocks are on.
import { FlaskConicalIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { mockedEndpoints, type MockMode } from "@/lib/api/mode";

const SCENARIO_LABELS: Record<string, string> = {
  none: "No open cycle",
  requested: "Requested",
  approved: "Approved, email sent",
  approved_failed: "Approved, email failed",
  submitted: "Submitted",
  in_review: "In review",
  window_open: "Window open",
  picked_up: "Picked up",
  declined: "Declined",
  rejected: "Rejected, link coming",
  rejected_new_link: "Rejected, new link ready",
  missed: "Missed",
  signed_out: "Signed out",
  not_enrolled: "Signed in, not enrolled",
};

export function MockBadge({ mode }: { mode: Exclude<MockMode, "off"> }) {
  const [open, setOpen] = useState(false);
  const mocked = mockedEndpoints();

  async function scenario(value: string) {
    const m = await import("@/lib/api/mocks");
    m.setScenario(value as Parameters<typeof m.setScenario>[0]);
    window.location.reload();
  }

  async function resetAll() {
    const m = await import("@/lib/api/mocks");
    m.resetMockData();
    window.location.reload();
  }

  function role(value: "prescriber" | "staff") {
    document.cookie = `pc-mock-role=${value}; path=/; samesite=lax`;
    window.location.reload();
  }

  return (
    // A slim tab on the left edge: always visible, and clear of sticky bottom buttons, headers
    // and the Next.js dev indicator.
    <div className="fixed top-1/2 left-0 z-[100] flex -translate-y-1/2 items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex rotate-180 items-center gap-1.5 rounded-l-lg border-y-2 border-l-2 border-black/20 bg-warn px-1 py-3 text-[0.7rem] font-bold tracking-wide text-black uppercase shadow-lg [writing-mode:vertical-rl]"
      >
        <FlaskConicalIcon className="size-3.5 rotate-90" aria-hidden />
        Mock data
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Mock data controls"
          className="w-72 space-y-3 rounded-2xl border border-warn/60 bg-surface p-4 text-sm text-mist shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">Mock data is on</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close mock controls" className="text-haze hover:text-mist">
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
          <p className="text-xs text-haze">
            {mode === "all"
              ? "Every endpoint and Supabase auth answer from the mock adapter."
              : `${mocked.length} endpoints the backend hasn't built answer from the mock adapter. The rest are live.`}
          </p>
          <label className="flex flex-col gap-1 text-xs font-medium text-haze">
            Patient portal state
            <select
              defaultValue=""
              onChange={(e) => e.target.value && void scenario(e.target.value)}
              className="h-9 rounded-md border border-input bg-ink px-2 text-sm text-mist"
            >
              <option value="" disabled>
                Choose a state…
              </option>
              {Object.entries(SCENARIO_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {mode === "all" ? (
            <div className="flex flex-col gap-1 text-xs font-medium text-haze">
              Clinic role
              <div className="flex gap-2">
                <button type="button" onClick={() => role("staff")} className="h-8 flex-1 rounded-md border border-line hover:bg-raised">
                  Staff
                </button>
                <button type="button" onClick={() => role("prescriber")} className="h-8 flex-1 rounded-md border border-line hover:bg-raised">
                  Prescriber
                </button>
              </div>
            </div>
          ) : null}
          <button type="button" onClick={() => void resetAll()} className="h-8 w-full rounded-md border border-line text-xs hover:bg-raised">
            Reset mock data
          </button>
        </div>
      ) : null}
    </div>
  );
}
