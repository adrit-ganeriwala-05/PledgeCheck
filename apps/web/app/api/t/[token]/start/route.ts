// POST /api/t/:token/start — the patient taps Start. Owner: Nihalika (N2).
// ready  → sets used_at (once), writes session.started, 200 { state: "active", sessionEndsAt, challengeCode }
// active → 200 with the same values (idempotent; reopening the link mid-session works)
// other  → 409 { ok: false, state }; unknown token → 404 { ok: false, state: "invalid" }
import { NextResponse } from "next/server";

import { clientIp, rateLimit } from "@/lib/fraud/rate-limit";
import { startSession } from "@/lib/fraud/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, ctx: RouteContext<"/api/t/[token]/start">) {
  const limit = rateLimit(`t:${clientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, state: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { token } = await ctx.params;
  try {
    const result = await startSession(token, new Date());
    const status = result.ok ? 200 : result.state === "invalid" ? 404 : 409;
    return NextResponse.json(result, { status, headers: NO_STORE });
  } catch (err) {
    console.error("[t] start failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, state: "error" }, { status: 500, headers: NO_STORE });
  }
}
