import { describe, expect, it } from "vitest";

import { makeCard } from "@/test/queue-card-fixture";

import { sortByUrgency } from "./sort";

const win = (closesAt: string) => ({ opensAt: "2026-09-20T00:00:00Z", closesAt, isFirstRx: false });

describe("sortByUrgency", () => {
  it("puts open windows first, soonest closing first, and keeps server order for the rest", () => {
    const a = makeCard({ submissionId: "a", status: "needs_review" });
    const b = makeCard({ submissionId: "b" });
    const c = makeCard({ submissionId: "c", window: win("2026-09-30T00:00:00Z") });
    const d = makeCard({ submissionId: "d", window: win("2026-09-28T00:00:00Z") });
    expect(sortByUrgency([a, b, c, d]).map((x) => x.submissionId)).toEqual(["d", "c", "a", "b"]);
  });
});

describe("countdownTone", () => {
  it("is amber inside 72 hours and red inside 24", async () => {
    const { countdownTone } = await import("./window-countdown");
    const now = Date.parse("2026-09-27T00:00:00Z");
    const at = (h: number) => new Date(now + h * 3600e3).toISOString();
    expect(countdownTone(at(100), now)).toBe("calm");
    expect(countdownTone(at(48), now)).toBe("soon");
    expect(countdownTone(at(10), now)).toBe("urgent");
    expect(countdownTone(at(-1), now)).toBe("urgent");
  });
});
