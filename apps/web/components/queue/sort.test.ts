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
