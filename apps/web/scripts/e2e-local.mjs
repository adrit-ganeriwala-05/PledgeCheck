// Local end-to-end check of GET /api/queue and POST /api/reviews against the local
// Supabase stack and seed. Refuses to run against anything but localhost.
//
//   npx supabase@2.118.0 db reset          # fresh seed (local only)
//   pnpm build && <start the app on :3100 with the local NEXT_PUBLIC_* and SUPABASE_SERVICE_ROLE_KEY>
//   node scripts/e2e-local.mjs             # from apps/web
//
// The only object it uploads is a 1x1 blank PNG placeholder (not a test photo), used to
// check signed URLs and photo deletion.
import { execSync } from "node:child_process";
import assert from "node:assert/strict";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const PASSWORD = "pledgecheck-dev"; // local seed only, see README

const status = JSON.parse(execSync("npx -y supabase@2.118.0 status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const SUPABASE_URL = status.API_URL;
for (const url of [SUPABASE_URL, BASE_URL]) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`refusing to run against ${url}`);
}

const admin = createClient(SUPABASE_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SUB = {
  northReady: "13000000-0000-0000-0000-000000000001",
  northDisagree: "13000000-0000-0000-0000-000000000003",
  northFraud: "13000000-0000-0000-0000-000000000005",
};
const NORTH = "10000000-0000-0000-0000-000000000000";

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

// Signs in through Supabase Auth and returns the Cookie header @supabase/ssr expects.
async function cookieFor(email) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, status.ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function api(path, cookie, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function submission(id) {
  const { data, error } = await admin.from("submissions").select("status, photo_path, phash").eq("id", id).single();
  if (error) throw error;
  return data;
}

// --- preconditions: fresh seed -------------------------------------------------
const pre = await submission(SUB.northDisagree);
assert.equal(pre.status, "needs_review", "run `npx supabase@2.118.0 db reset` first");

// Placeholder object for the disagreement card (blank 1x1 PNG).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
{
  const { error } = await admin.storage.from("photos").upload(pre.photo_path, PNG_1X1, { contentType: "image/png", upsert: true });
  if (error) throw error;
}

const rx1 = await cookieFor("prescriber1@example.test");
const staff1 = await cookieFor("staff1@example.test");
const rx2 = await cookieFor("prescriber2@example.test");

// --- GET /api/queue -----------------------------------------------------------
await check("queue: 401 without a session", async () => {
  assert.equal((await api("/api/queue")).status, 401);
});

await check("queue: prescriber sees own practice, reviewable only, needs_review first", async () => {
  const { status: code, body } = await api("/api/queue", rx1);
  assert.equal(code, 200);
  assert.equal(body.cards.length, 4);
  assert.deepEqual(body.cards.map((c) => c.status), ["needs_review", "needs_review", "ready_for_review", "ready_for_review"]);
  assert.ok(body.cards.every((c) => c.submissionId.startsWith("13") && c.canReview));
  assert.ok(!body.cards.some((c) => c.submissionId === SUB.northFraud));
});

await check("queue: signed URL for the uploaded object, null for missing ones", async () => {
  const { body } = await api("/api/queue", rx1);
  const withPhoto = body.cards.find((c) => c.submissionId === SUB.northDisagree);
  assert.match(withPhoto.photoUrl, /\/storage\/v1\/object\/sign\/photos\//);
  assert.equal((await fetch(withPhoto.photoUrl)).status, 200);
  assert.ok(body.cards.filter((c) => c.submissionId !== SUB.northDisagree).every((c) => c.photoUrl === null));
  assert.equal(withPhoto.readersAgree, false);
});

await check("queue: staff read-only, other practice isolated", async () => {
  const staff = await api("/api/queue", staff1);
  assert.ok(staff.body.cards.length === 4 && staff.body.cards.every((c) => !c.canReview));
  const south = await api("/api/queue", rx2);
  assert.ok(south.body.cards.length === 4 && south.body.cards.every((c) => c.submissionId.startsWith("23")));
});

// --- POST /api/reviews ------------------------------------------------------
await check("reviews: staff gets 403", async () => {
  const r = await api("/api/reviews", staff1, { submissionId: SUB.northReady, decision: "rejected", reason: "x" });
  assert.equal(r.status, 403);
});

await check("reviews: other practice's submission is 404", async () => {
  const r = await api("/api/reviews", rx2, { submissionId: SUB.northReady, decision: "rejected", reason: "x" });
  assert.equal(r.status, 404);
});

await check("reviews: approve without window logic is 503 and writes nothing", async () => {
  const r = await api("/api/reviews", rx1, { submissionId: SUB.northReady, decision: "approved" });
  assert.deepEqual(r, { status: 503, body: { error: "window_logic_unavailable" } });
  assert.equal((await submission(SUB.northReady)).status, "ready_for_review");
  const { count } = await admin.from("reviews").select("id", { count: "exact", head: true }).eq("submission_id", SUB.northReady);
  assert.equal(count, 0);
});

await check("reviews: reject without a reason is 400", async () => {
  assert.equal((await api("/api/reviews", rx1, { submissionId: SUB.northDisagree, decision: "rejected" })).status, 400);
});

await check("reviews: reject saves the decision, reports the missing audit log, deletes the photo", async () => {
  const r = await api("/api/reviews", rx1, { submissionId: SUB.northDisagree, decision: "rejected", reason: "Readers disagree; repeat in clinic" });
  assert.deepEqual(r, { status: 500, body: { error: "audit_failed", reviewRecorded: true } });
  const after = await submission(SUB.northDisagree);
  assert.equal(after.status, "rejected");
  assert.equal(after.photo_path, null);
  assert.ok(after.phash, "phash is kept");
  const { data: review } = await admin.from("reviews").select("decision, reason, clinician_id").eq("submission_id", SUB.northDisagree).single();
  assert.deepEqual(review, { decision: "rejected", reason: "Readers disagree; repeat in clinic", clinician_id: "11111111-0000-0000-0000-000000000001" });
  const { data: listing } = await admin.storage.from("photos").list(NORTH);
  assert.ok(!listing.some((o) => pre.photo_path.endsWith(o.name)), "object removed");
});

await check("reviews: second decision on the same test is 409", async () => {
  const r = await api("/api/reviews", rx1, { submissionId: SUB.northDisagree, decision: "rejected", reason: "again" });
  assert.equal(r.status, 409);
});

await check("queue: reviewed card is gone", async () => {
  const { body } = await api("/api/queue", rx1);
  assert.equal(body.cards.length, 3);
  assert.ok(!body.cards.some((c) => c.submissionId === SUB.northDisagree));
});

// --- the browser cannot bypass the route ----------------------------------------
await check("bypass: a signed-in prescriber cannot call submit_review or insert reviews directly", async () => {
  const direct = createClient(SUPABASE_URL, status.ANON_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await direct.auth.signInWithPassword({ email: "prescriber1@example.test", password: PASSWORD });
  if (signInError) throw signInError;
  const rpc = await direct.rpc("submit_review", {
    p_clinician_id: "11111111-0000-0000-0000-000000000001",
    p_submission_id: SUB.northReady,
    p_decision: "approved",
    p_reason: null,
    p_window: { opens_at: "2026-09-26T00:00:00Z", closes_at: "2027-09-26T00:00:00Z" },
  });
  assert.equal(rpc.error?.code, "42501");
  const insert = await direct
    .from("reviews")
    .insert({ submission_id: SUB.northReady, clinician_id: "11111111-0000-0000-0000-000000000001", decision: "approved" });
  assert.equal(insert.error?.code, "42501");
  assert.equal((await submission(SUB.northReady)).status, "ready_for_review");
});

console.log(`\n${passed} checks passed`);
