// GET /api/t/:token — public link status for the patient's phone. Owner: Nihalika (N1/N2).
// → { ok, state, language, sessionEndsAt, challengeCode }
// challengeCode is non-null only while the session is active. Never returns patient,
// practice or request identifiers. An unknown token is 404 { ok: false, state: "invalid" }.
import { NextResponse } from "next/server";

import { clientIp, rateLimit } from "@/lib/fraud/rate-limit";
import { getLinkStatus } from "@/lib/fraud/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, ctx: RouteContext<"/api/t/[token]">) {
  const limit = rateLimit(`t:${clientIp(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, state: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { token } = await ctx.params;
  try {
    const status = await getLinkStatus(token, new Date());
    return NextResponse.json(status, { status: status.state === "invalid" ? 404 : 200, headers: NO_STORE });
  } catch (err) {
    console.error("[t] link lookup failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, state: "error" }, { status: 500, headers: NO_STORE });
  }
}
