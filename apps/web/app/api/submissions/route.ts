// POST /api/submissions — the whole patient-to-queue pipeline.
// Owner: Labib (ticket L4).
//
// Order matters, and it is the order in the PRD's fraud-check table: the cheap
// checks that need no AI run first, so a replayed link or a reused photo never
// costs an API call.
//
//   1. one-time link      (N1)
//   2. live camera only   (enforced on the page; the server stamps its own time)
//   3. challenge code     (N2, checked inside the rules engine)
//   4. photo reuse        (N3, on the Vultr phash)
//   5. two readers agree  (Grok + OpenCV)
//   then the rules engine decides, and nothing here can approve anything.
//
// The submissions row is created before the photo is uploaded, because the storage
// policy keys objects on <practice_id>/<submission_id>.jpg (db/policies.sql) and the
// id only exists after the insert. Photo and read columns are nullable for exactly
// this reason, so the row starts as awaiting_photo and is completed below.
import { NextResponse } from "next/server";

import { analyzePhoto, AnalyzeError } from "@/lib/ai/analyze";
import { GrokReadError, readTestPhoto } from "@/lib/ai/grok";
import { appendAuditEvent } from "@/lib/audit/chain";
import { checkReuse } from "@/lib/fraud/reuse";
import { checkToken, consumeRequest } from "@/lib/fraud/token";
import { evaluate } from "@/lib/rules/engine";
import { statusFor } from "@/lib/rules/status";
import type { Patient, Read, Submission } from "@/lib/rules/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel caps a serverless request body around 4.5 MB; the page sends ~1 MB. */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_BUCKET = "photos";

type Admin = ReturnType<typeof createAdminClient>;

export async function POST(request: Request) {
  const now = new Date();
  const db = createAdminClient();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("could not read the upload", 400);
  }

  const token = String(form.get("token") ?? "");
  const image = form.get("image");

  if (!token) return bad("missing token", 400);
  if (!(image instanceof File)) return bad("missing photo", 400);
  if (image.size === 0) return bad("the photo was empty", 400);
  if (image.size > MAX_PHOTO_BYTES) return bad("the photo is too large; retake it", 413);
  if (!ALLOWED_TYPES.includes(image.type)) return bad("unsupported photo format", 415);

  // Fraud check 1 — one-time link.
  const tokenCheck = await checkToken(db, token, now);
  if (!tokenCheck.ok) {
    await appendAuditEvent(
      db,
      {
        actor: "patient",
        action: "submission.rejected_link",
        refId: null,
        payload: { failure: tokenCheck.failure },
      },
      now,
    );
    const status = tokenCheck.failure === "expired" ? "expired" : "rejected_fraud";
    return NextResponse.json(
      { submissionId: null, status, reason: tokenCheck.failure },
      { status: 410 },
    );
  }

  const testRequest = tokenCheck.request;

  // Claim the link before spending any AI budget, so a replay cannot race us.
  if (!(await consumeRequest(db, testRequest.id, now))) {
    return NextResponse.json(
      { submissionId: null, status: "rejected_fraud", reason: "already_used" },
      { status: 410 },
    );
  }

  const patient = await loadPatient(db, testRequest.patient_id);
  if (!patient) return bad("patient not found for this link", 404);

  // The row is claimed now so the storage path can use its id.
  const { data: created, error: createError } = await db
    .from("submissions")
    .insert({ request_id: testRequest.id, status: "awaiting_photo", flags: [] })
    .select("id")
    .single();

  if (createError || !created) {
    console.error("submission insert failed", createError);
    return bad("could not record the submission", 500);
  }

  const submissionId = created.id;

  // Fraud check 2 — the server stamps its own capture time. The page allows no
  // file picker, but the timestamp is ours either way.
  const capturedAt = now.toISOString();

  const bytes = Buffer.from(await image.arrayBuffer());
  const photoPath = `${patient.practiceId}/${submissionId}.jpg`;

  const upload = await db.storage
    .from(PHOTO_BUCKET)
    .upload(photoPath, bytes, { contentType: image.type, upsert: true });
  if (upload.error) {
    console.error("photo upload failed", upload.error);
    return bad("could not store the photo; try again", 502);
  }

  // Both readers at once: neither depends on the other.
  const [grokSettled, cvSettled] = await Promise.allSettled([
    readTestPhoto({ base64: bytes.toString("base64"), mimeType: image.type }),
    analyzePhoto(new Blob([new Uint8Array(bytes)], { type: image.type })),
  ]);

  const grok = grokSettled.status === "fulfilled" ? grokSettled.value : null;
  const cv = cvSettled.status === "fulfilled" ? cvSettled.value : null;

  if (grokSettled.status === "rejected") {
    console.error("grok read failed", describe(grokSettled.reason));
  }
  if (cvSettled.status === "rejected") {
    console.error("analyze failed", describe(cvSettled.reason));
  }

  if (!grok && !cv) {
    return bad("neither reader could process the photo; retake it", 502);
  }

  const flags: string[] = [];
  if (!grok) flags.push("grok_unavailable");
  if (!cv) flags.push("opencv_unavailable");

  // Fraud check 4 — photo reuse, on the hash the Vultr service computed.
  let phash: string | null = null;
  if (cv) {
    phash = cv.phash;
    const reuse = await checkReuse(db, cv.phash, submissionId);
    if (reuse.reused) flags.push("photo_already_used");
  }

  const reads: Read[] = [];
  if (grok) {
    reads.push({
      source: "grok",
      result: grok.result,
      confidence: grok.confidence,
      codeRead: grok.code_read,
    });
  }
  if (cv) reads.push({ source: "cv", result: cv.result, confidence: cv.confidence });

  const submission: Submission = {
    id: submissionId,
    setting: testRequest.setting,
    isFirstRx: patient.phase === "pre" || !patient.lastWindow,
    capturedAt,
    challengeCode: testRequest.challenge_code,
    // A photo_already_used flag blocks; an unavailable reader only flags.
    flags: flags.filter((f) => f === "photo_already_used"),
  };

  const evaluation = evaluate(patient, submission, reads, now);
  const status = statusFor(evaluation);

  const { error: updateError } = await db
    .from("submissions")
    .update({
      photo_path: photoPath,
      phash,
      captured_at: capturedAt,
      grok_result: grok?.result ?? null,
      grok_code: grok?.code_read ?? null,
      grok_confidence: grok?.confidence ?? null,
      cv_result: cv?.result ?? null,
      cv_confidence: cv?.confidence ?? null,
      flags: [...flags, ...evaluation.reasons],
      status,
    })
    .eq("id", submissionId);

  if (updateError) {
    console.error("submission update failed", updateError);
    return bad("could not record the submission", 500);
  }

  await appendAuditEvent(
    db,
    {
      actor: `patient:${patient.id}`,
      action: "submission.received",
      refId: submissionId,
      payload: {
        status,
        decision: evaluation.decision,
        reasons: evaluation.reasons,
        setting: testRequest.setting,
      },
    },
    now,
  );

  // The patient is told their test was received, never what it read. The result
  // belongs to the dermatologist, who has not looked at it yet.
  return NextResponse.json({
    submissionId,
    status,
    received: status !== "rejected_fraud" && status !== "rejected",
    reasons: evaluation.reasons,
  });
}

/** The rules-engine patient, plus the practice id the storage path needs. */
type PipelinePatient = Patient & { practiceId: string };

async function loadPatient(db: Admin, patientId: string): Promise<PipelinePatient | null> {
  const { data: row, error } = await db
    .from("patients")
    .select(
      "id, practice_id, can_get_pregnant, home_testing_allowed, phase, treatment_start, language",
    )
    .eq("id", patientId)
    .maybeSingle();

  if (error || !row) return null;

  const { data: w } = await db
    .from("windows")
    .select("is_first_rx, opens_at, closes_at, filled_at, status")
    .eq("patient_id", patientId)
    .order("opens_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    id: row.id,
    practiceId: row.practice_id,
    canGetPregnant: row.can_get_pregnant,
    homeTestingAllowed: row.home_testing_allowed,
    phase: row.phase as Patient["phase"],
    treatmentStart: row.treatment_start,
    language: row.language as Patient["language"],
    lastWindow: w
      ? {
          isFirstRx: w.is_first_rx,
          opensAt: w.opens_at,
          closesAt: w.closes_at,
          filledAt: w.filled_at,
          status: w.status as "open" | "filled" | "missed",
        }
      : null,
  };
}

function describe(error: unknown): string {
  if (error instanceof GrokReadError || error instanceof AnalyzeError) return error.message;
  return String(error);
}

function bad(reason: string, status: number) {
  return NextResponse.json({ submissionId: null, status: "error", reason }, { status });
}
