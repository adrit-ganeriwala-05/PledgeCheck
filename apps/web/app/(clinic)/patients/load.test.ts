import { describe, expect, it } from "vitest";

import { mockSupabase } from "@/test/supabase-mock";

import { latestRequestStates, loadPatients } from "./load";

const NOW = new Date("2026-09-26T15:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe("latestRequestStates", () => {
  it("picks the newest request per patient and derives its state", () => {
    const states = latestRequestStates(
      [
        { id: "r1", patient_id: "p1", setting: "clinic", expires_at: at(-600), used_at: null },
        { id: "r2", patient_id: "p1", setting: "home", expires_at: at(600), used_at: at(-5) },
        { id: "r3", patient_id: "p2", setting: "home", expires_at: at(600), used_at: at(-5) },
        { id: "r4", patient_id: "p3", setting: "home", expires_at: at(-1), used_at: null },
      ],
      new Set(["r3"]),
      NOW,
    );
    expect(states.get("p1")).toEqual({ state: "active", setting: "home", expiresAt: at(600) });
    expect(states.get("p2")?.state).toBe("submitted");
    expect(states.get("p3")?.state).toBe("link_expired");
    expect(states.has("p4")).toBe(false);
  });
});

describe("loadPatients", () => {
  it("maps rows and attaches the latest link state", async () => {
    const { client } = mockSupabase({
      tables: {
        patients: {
          data: [
            { id: "p1", pseudonym: "PT-A1", phase: "during", language: "es", can_get_pregnant: true, home_testing_allowed: true, auth_user_id: "u1" },
            { id: "p2", pseudonym: "PT-A2", phase: "pre", language: "en", can_get_pregnant: false, home_testing_allowed: false, auth_user_id: null },
          ],
          error: null,
        },
        test_requests: { data: [{ id: "r1", patient_id: "p1", setting: "home", expires_at: at(600), used_at: null }], error: null },
        submissions: { data: [], error: null },
        refill_requests: {
          data: [{ patient_id: "p1", created_at: at(-60), status: "requested", test_request_id: null, test_requests: null }],
          error: null,
        },
      },
    });
    const rows = await loadPatients(client as never, NOW);
    expect(rows).toEqual([
      {
        id: "p1",
        pseudonym: "PT-A1",
        phase: "during",
        language: "es",
        canGetPregnant: true,
        homeTestingAllowed: true,
        latest: { state: "ready", setting: "home", expiresAt: at(600) },
        enrolled: true,
        cycleStatus: "requested",
      },
      {
        id: "p2",
        pseudonym: "PT-A2",
        phase: "pre",
        language: "en",
        canGetPregnant: false,
        homeTestingAllowed: false,
        latest: null,
        enrolled: false,
        cycleStatus: null,
      },
    ]);
    // Only the pseudonym leaves the table: no name, DOB or other identifiers are selected.
    expect(JSON.stringify(rows)).not.toMatch(/name|dob|birth/i);
  });

  it("returns [] for a practice with no patients", async () => {
    const { client } = mockSupabase({ tables: { patients: { data: [], error: null } } });
    expect(await loadPatients(client as never, NOW)).toEqual([]);
  });

  it("throws when patients cannot be read", async () => {
    const { client } = mockSupabase({ tables: { patients: { data: null, error: { message: "boom" } } } });
    await expect(loadPatients(client as never, NOW)).rejects.toThrow(/could not load patients/);
  });
});
