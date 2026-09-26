// Local end-to-end check of the patient link flow and the audit chain, against the local
// Supabase stack and seed. Refuses to run against anything but localhost.
//
//   npx supabase@2.118.0 db reset          # fresh seed (local only)
//   pnpm build && <start the app on :3100 with the local NEXT_PUBLIC_* and SUPABASE_SERVICE_ROLE_KEY>
//   node scripts/e2e-link-flow.mjs         # from apps/web (after e2e-local.mjs, or on its own)
//
// Covers: issuing links (and the home-link refusals), the public link status, Start, the
// home-testing switch, upload rejections that happen before any AI call, and an
// independent re-verification of every audit hash (spec in lib/audit/hash.ts). No AI keys
// are needed: no upload here reaches a reader.
import { createHash } from "node:crypto";
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

const PATIENT = {
  eligible: "11000000-0000-0000-0000-000000000001", // PT-1042: during, home testing on
  spanish: "11000000-0000-0000-0000-000000000002", // PT-1057: during, home testing on, es
  pre: "11000000-0000-0000-0000-000000000004", // PT-1071: pre-treatment
  noPregnancy: "11000000-0000-0000-0000-000000000005", // PT-1088: cannot get pregnant
  south: "21000000-0000-0000-0000-000000000001", // PT-2013: other practice
};
const STAFF1 = "11111111-0000-0000-0000-000000000002";

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

async function api(path, { cookie, method = "GET", body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function uploadWith(token) {
  const form = new FormData();
  form.append("token", token);
  form.append("image", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: "image/jpeg" }), "test.jpg");
  const res = await fetch(`${BASE_URL}/api/submissions`, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Independent implementation of the audit hash spec (lib/audit/hash.ts).
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(",")}}`;
}
function auditHash(prevHash, row) {
  const fields = {
    seq: Number(row.seq),
    actor: row.actor,
    action: row.action,
    ref_id: row.ref_id ?? null,
    payload: row.payload ?? {},
    created_at: new Date(row.created_at).toISOString(),
  };
  return sha256(prevHash + canonicalJson(fields));
}

const staff1 = await cookieFor("staff1@example.test");

// --- POST /api/requests ------------------------------------------------------------
await check("requests: 401 without a session", async () => {
  assert.equal((await api("/api/requests", { method: "POST", body: { patientId: PATIENT.eligible, setting: "home" } })).status, 401);
});

await check("requests: home links refused for pre-treatment and cannot-get-pregnant patients", async () => {
  const pre = await api("/api/requests", { cookie: staff1, method: "POST", body: { patientId: PATIENT.pre, setting: "home" } });
  assert.deepEqual(pre, { status: 409, body: { error: "home_testing_not_allowed", reason: "pre_treatment" } });
  const none = await api("/api/requests", { cookie: staff1, method: "POST", body: { patientId: PATIENT.noPregnancy, setting: "home" } });
  assert.deepEqual(none, { status: 409, body: { error: "home_testing_not_allowed", reason: "cannot_get_pregnant" } });
});

await check("requests: another practice's patient is 404", async () => {
  const r = await api("/api/requests", { cookie: staff1, method: "POST", body: { patientId: PATIENT.south, setting: "clinic" } });
  assert.equal(r.status, 404);
});

let token;
let requestId;
let code;
await check("requests: issues a link, stores only the token hash, returns no code", async () => {
  const r = await api("/api/requests", { cookie: staff1, method: "POST", body: { patientId: PATIENT.eligible, setting: "home" } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["expiresAt", "link", "requestId"]);
  token = /\/t\/([A-Za-z0-9_-]{43})$/.exec(r.body.link)?.[1];
  assert.ok(token, "link ends in a 43-character token");
  requestId = r.body.requestId;

  const { data: row, error } = await admin.from("test_requests").select("token_hash, challenge_code, used_at, created_by").eq("id", requestId).single();
  if (error) throw error;
  assert.equal(row.token_hash, sha256(token));
  assert.equal(row.used_at, null);
  assert.equal(row.created_by, STAFF1);
  code = row.challenge_code.trim();
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
  assert.ok(!JSON.stringify(r.body).includes(code));
});

// --- the patient's phone, before Start ------------------------------------------------
await check("link: status is ready, with no code", async () => {
  const r = await api(`/api/t/${token}`);
  assert.deepEqual(r, { status: 200, body: { ok: true, state: "ready", language: "en", sessionEndsAt: null, challengeCode: null } });
});

await check("link: the capture page HTML does not contain the code before Start", async () => {
  const res = await fetch(`${BASE_URL}/t/${token}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Start"));
  assert.ok(!html.includes(code));
});

await check("upload: before Start is 410 session_not_started, before any AI call", async () => {
  assert.deepEqual(await uploadWith(token), {
    status: 410,
    body: { submissionId: null, status: "rejected_fraud", reason: "session_not_started" },
  });
  const { count } = await admin.from("submissions").select("id", { count: "exact", head: true }).eq("request_id", requestId);
  assert.equal(count, 0);
});

await check("upload: an unknown token is 410 invalid_link", async () => {
  assert.deepEqual(await uploadWith("x".repeat(43)), {
    status: 410,
    body: { submissionId: null, status: "rejected_fraud", reason: "invalid_link" },
  });
});

// --- Start ---------------------------------------------------------------------------------
let endsAt;
await check("start: reveals the code and a 40-minute deadline; used_at is set", async () => {
  const r = await api(`/api/t/${token}/start`, { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal(r.body.state, "active");
  assert.equal(r.body.challengeCode, code);
  endsAt = r.body.sessionEndsAt;
  const { data: row } = await admin.from("test_requests").select("used_at").eq("id", requestId).single();
  assert.equal(Date.parse(endsAt) - Date.parse(row.used_at), 40 * 60_000);
});

await check("start: a second tap returns the same code and deadline", async () => {
  const r = await api(`/api/t/${token}/start`, { method: "POST" });
  assert.deepEqual(r, { status: 200, body: { ok: true, state: "active", sessionEndsAt: endsAt, challengeCode: code } });
  const { count } = await admin.from("audit_events").select("seq", { count: "exact", head: true }).eq("action", "session.started").eq("ref_id", requestId);
  assert.equal(count, 1);
});

await check("link: status is active, now with the code", async () => {
  const r = await api(`/api/t/${token}`);
  assert.deepEqual(r.body, { ok: true, state: "active", language: "en", sessionEndsAt: endsAt, challengeCode: code });
});

// --- home-testing switch ---------------------------------------------------------------------
await check("patients: turning home testing off blocks home links, and is audited", async () => {
  const off = await api(`/api/patients/${PATIENT.spanish}/home-testing`, { cookie: staff1, method: "PATCH", body: { allowed: false } });
  assert.deepEqual(off, { status: 200, body: { patientId: PATIENT.spanish, allowed: false, changed: true } });
  const refused = await api("/api/requests", { cookie: staff1, method: "POST", body: { patientId: PATIENT.spanish, setting: "home" } });
  assert.deepEqual(refused.body, { error: "home_testing_not_allowed", reason: "not_permitted" });
  const on = await api(`/api/patients/${PATIENT.spanish}/home-testing`, { cookie: staff1, method: "PATCH", body: { allowed: true } });
  assert.equal(on.body.changed, true);
  const { data } = await admin.from("audit_events").select("payload").eq("action", "patient.home_testing_changed").eq("ref_id", PATIENT.spanish).order("seq");
  assert.deepEqual(data.map((r) => r.payload), [{ allowed: false }, { allowed: true }]);
});

await check("patients: another practice's patient is 404", async () => {
  const r = await api(`/api/patients/${PATIENT.south}/home-testing`, { cookie: staff1, method: "PATCH", body: { allowed: false } });
  assert.equal(r.status, 404);
});

// --- audit chain -------------------------------------------------------------------------------
await check("audit: expected events written, with no token or code in any payload", async () => {
  const { data: rows, error } = await admin.from("audit_events").select("actor, action, ref_id, payload").order("seq");
  if (error) throw error;
  const has = (action, refId) => rows.some((r) => r.action === action && r.ref_id === refId);
  assert.ok(has("request.issued", requestId));
  assert.ok(has("session.started", requestId));
  const rejections = rows.filter((r) => r.action === "submission.rejected_fraud").map((r) => r.payload.reason);
  assert.ok(rejections.includes("session_not_started") && rejections.includes("invalid_link"));
  const issued = rows.find((r) => r.action === "request.issued" && r.ref_id === requestId);
  assert.deepEqual(issued.payload, { setting: "home" });
  assert.equal(issued.actor, `clinician:${STAFF1}`);
  const all = JSON.stringify(rows);
  assert.ok(!all.includes(token), "no token in the audit log");
  assert.ok(!all.includes(code), "no challenge code in the audit log");
});

await check("audit: every stored hash re-verifies from seq 1 after the Postgres round trip", async () => {
  const { data: rows, error } = await admin.from("audit_events").select("*").order("seq");
  if (error) throw error;
  let prev = "0".repeat(64);
  rows.forEach((row, i) => {
    assert.equal(Number(row.seq), i + 1, "contiguous seq");
    assert.equal(row.prev_hash, prev, `prev_hash at seq ${row.seq}`);
    assert.equal(row.hash, auditHash(prev, row), `hash at seq ${row.seq}`);
    prev = row.hash;
  });
  console.log(`    (${rows.length} audit rows verified)`);
});

console.log(`\n${passed} checks passed`);
