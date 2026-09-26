// POST /api/submissions — the whole patient-to-queue pipeline.
// Owner: Labib (ticket L4).
//
// Order matters, and it is the order in the PRD's fraud-check table: the cheap
// checks that need no AI run first, so a replayed link or a reused photo never
// costs an API call.
//
//   1. one-time link      (N1/N2: checkSessionForUpload — the patient tapped Start
//                          and the session is still running)
//   2. live camera only   (enforced on the page; the server stamps its own time)
//   3. challenge code     (N2: checkChallengeCode on Grok's read)
//   4. photo reuse        (N3: checkPhotoReuse on the Vultr phash)
//   5. two readers agree  (Grok + OpenCV)
//   then the rules engine decides, and nothing here can approve anything.
//
// Every fraud failure is audited once with recordFraudRejection (payload { reason }
// only; never the code, phash or token).
//
// The submissions row is created before the photo is uploaded, because the storage
// policy keys objects on <practice_id>/<submission_id>.jpg (db/policies.sql) and the
// id only exists after the insert. Photo and read columns are nullable for exactly
// this reason, so the row starts as awaiting_photo and is completed below.
import { NextResponse } from "next/server";

import { analyzePhoto, AnalyzeError } from "@/lib/ai/analyze";
import { GrokReadError, readTestPhoto } from "@/lib/ai/grok";
import { appendAuditEvent } from "@/lib/audit/chain";
import {
  checkChallengeCode,
  checkPhotoReuse,
  checkSessionForUpload,
  recordFraudRejection,
  type SessionFailure,
} from "@/lib/fraud/checks";
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
/** Fraud flags that stop a submission; any other flag is information for the prescriber. */
const BLOCKING_FLAGS = ["photo_already_used", "code_missing_or_wrong"];
const UNIQUE_VIOLATION = "23505";

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

  // Fraud check 1 — one-time link, inside an active session.
  let session: Awaited<ReturnType<typeof checkSessionForUpload>>;
  try {
    session = await checkSessionForUpload(token, now);
  } catch (error) {
    console.error("link check failed", describe(error));
    return bad("could not check the link; try again", 500);
  }
  if (!session.ok) {
    await recordFraudRejection(session.requestId, session.reason);
    return linkRejected(session.reason);
  }

  const patient = await loadPatient(db, session.patientId);
  if (!patient) return bad("patient not found for this link", 404);

  // Claim the link before spending any AI budget, so a replay cannot race us: the row
  // is unique per request, so a second upload loses here. The storage path uses its id.
  const { data: created, error: createError } = await db
    .from("submissions")
    .insert({ request_id: session.requestId, status: "awaiting_photo", flags: [] })
    .select("id")
    .single();

  if (createError?.code === UNIQUE_VIOLATION) {
    await recordFraudRejection(session.requestId, "already_submitted");
    return linkRejected("already_submitted");
  }
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

  // Fraud check 4 — photo reuse, on the hash the Vultr service computed. If the check
  // itself fails, the prescriber sees a flag instead of the pipeline stopping.
  let phash: string | null = null;
  if (cv) {
    phash = cv.phash;
    try {
      const reuse = await checkPhotoReuse(cv.phash, { excludeSubmissionId: submissionId });
      if (!reuse.ok) {
        flags.push("photo_already_used");
        await recordFraudRejection(session.requestId, "photo_already_used");
      }
    } catch (error) {
      console.error("reuse check failed", describe(error));
      flags.push("reuse_check_unavailable");
    }
  }

  // Fraud check 3 — the code written on the test, as Grok read it. Only a reader that
  // returned can be checked; without Grok the submission already needs review.
  if (grok && !checkChallengeCode(session.expectedCode, grok.code_read).ok) {
    flags.push("code_missing_or_wrong");
    await recordFraudRejection(session.requestId, "code_missing_or_wrong");
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
    setting: session.setting,
    isFirstRx: patient.phase === "pre" || !patient.lastWindow,
    capturedAt,
    challengeCode: session.expectedCode,
    // A failed fraud check blocks; an unavailable reader or reuse check only flags.
    flags: flags.filter((f) => BLOCKING_FLAGS.includes(f)),
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
        setting: session.setting,
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

/** A link that cannot take this photo. The patient needs a new link, or to tap Start. */
function linkRejected(reason: SessionFailure) {
  const status = reason === "session_expired" ? "expired" : "rejected_fraud";
  return NextResponse.json({ submissionId: null, status, reason }, { status: 410 });
}
