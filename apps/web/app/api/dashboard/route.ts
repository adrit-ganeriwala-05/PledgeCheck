// GET /api/dashboard — weekly totals for the drug maker. Owner: Labib (L8).
//
// Reads only from Tiger Data. There is no path from this endpoint to Supabase,
// so there is no path to a patient. Rows with fewer than 5 events are dropped
// inside weeklyAccess before they ever reach here.

import { NextResponse } from "next/server";
import { SMALL_COUNT_FLOOR, weeklyAccess } from "@/lib/analytics/tiger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await weeklyAccess();

  return NextResponse.json({
    source: "tigerdata:weekly_access",
    smallCountFloor: SMALL_COUNT_FLOOR,
    rows,
  });
}
