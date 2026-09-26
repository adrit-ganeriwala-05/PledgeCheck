// Queue card contract for GET /api/queue (owner: Adrit). Shared by the route and the UI.

export type ReaderResult = "positive" | "negative" | "invalid";

export type QueueCard = {
  submissionId: string;
  status: "ready_for_review" | "needs_review";
  capturedAt: string | null;
  patient: { pseudonym: string; phase: string; language: string };
  photoUrl: string | null;
  grok: {
    result: string | null;
    code: string | null;
    confidence: number | null;
    // Whether Grok's read code equals the challenge code issued with the link (null when
    // Grok read no code). Display only; the fraud check itself is Nihalika's.
    codeMatches: boolean | null;
  };
  opencv: { result: string | null; confidence: number | null };
  readersAgree: boolean;
  flags: string[];
  window: { opensAt: string; closesAt: string; isFirstRx: boolean } | null;
  canReview: boolean;
};

export type QueueResponse = { cards: QueueCard[] };

export const PHOTO_URL_TTL_SECONDS = 5 * 60;

export type SubmissionRow = {
  id: string;
  status: string;
  captured_at: string | null;
  photo_path: string | null;
  grok_result: string | null;
  grok_code: string | null;
  grok_confidence: number | null;
  cv_result: string | null;
  cv_confidence: number | null;
  flags: string[];
  test_requests: {
    challenge_code: string;
    patient_id: string;
    patients: { pseudonym: string; phase: string; language: string } | null;
  } | null;
};

export type WindowRow = {
  patient_id: string;
  opens_at: string;
  closes_at: string;
  is_first_rx: boolean;
};

const STATUS_ORDER: Record<string, number> = { needs_review: 0, ready_for_review: 1 };

function capturedTime(row: SubmissionRow): number {
  return row.captured_at ? Date.parse(row.captured_at) : Number.POSITIVE_INFINITY;
}

// needs_review first, then oldest capture first (missing capture times last).
export function sortForReview(rows: SubmissionRow[]): SubmissionRow[] {
  return [...rows].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || capturedTime(a) - capturedTime(b),
  );
}

// Latest-closing open window per patient.
export function openWindowByPatient(windows: WindowRow[]): Map<string, WindowRow> {
  const byPatient = new Map<string, WindowRow>();
  for (const w of windows) {
    const current = byPatient.get(w.patient_id);
    if (!current || Date.parse(w.closes_at) > Date.parse(current.closes_at)) byPatient.set(w.patient_id, w);
  }
  return byPatient;
}

export function buildCards(
  rows: SubmissionRow[],
  windows: WindowRow[],
  signedUrls: Map<string, string>,
  canReview: boolean,
): QueueCard[] {
  const windowFor = openWindowByPatient(windows);
  return sortForReview(rows)
    .filter((row) => row.test_requests?.patients)
    .map((row) => {
      const request = row.test_requests!;
      const patient = request.patients!;
      const window = windowFor.get(request.patient_id);
      return {
        submissionId: row.id,
        status: row.status as QueueCard["status"],
        capturedAt: row.captured_at,
        patient: { pseudonym: patient.pseudonym, phase: patient.phase, language: patient.language },
        photoUrl: (row.photo_path && signedUrls.get(row.photo_path)) || null,
        grok: {
          result: row.grok_result,
          code: row.grok_code,
          confidence: row.grok_confidence,
          codeMatches:
            row.grok_code === null ? null : row.grok_code.trim().toUpperCase() === request.challenge_code.trim().toUpperCase(),
        },
        opencv: { result: row.cv_result, confidence: row.cv_confidence },
        readersAgree: row.grok_result !== null && row.grok_result === row.cv_result,
        flags: row.flags ?? [],
        window: window
          ? { opensAt: window.opens_at, closesAt: window.closes_at, isFirstRx: window.is_first_rx }
          : null,
        canReview,
      };
    });
}
