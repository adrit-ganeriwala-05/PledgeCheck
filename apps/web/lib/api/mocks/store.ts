// The mock adapter's state. Kept in localStorage so a patient tab and a clinic tab (the split-
// screen demo) see the same data. It holds statuses, pseudonyms and timestamps only: never a
// token, link, challenge code or email address (a test checks this).

import type { PatientRow } from "@/app/(clinic)/patients/load";
import type { WindowRow } from "@/app/(clinic)/windows/window-list";
import type { QueueCard } from "@/lib/clinic/queue";

import type { Cycle, CycleStatus, RefillRequest } from "../contracts";

export const STORAGE_KEY = "pledgecheck.mock-db.v1";

/** The demo patient: the one a portal login maps to. */
export const DEMO_PATIENT = { id: "mock-patient-1042", pseudonym: "PT-1042" } as const;

export type MockDb = {
  patientSignedIn: boolean;
  /** How many sign-in requests reached the mock (patient and clinician): lets e2e prove one per submit.
   *  Never the email or the password. */
  signInAttempts?: number;
  patientEnrolled: boolean;
  cycle: Cycle | null;
  requests: RefillRequest[];
  /** Pseudonyms whose approve answers not_pending once (someone else got there first). */
  raceOnce: string[];
  enrolledPatientIds: string[];
  patients: PatientRow[];
  windows: WindowRow[];
  /** Stored without grok.code; the queue response fills it in. */
  queue: QueueCard[];
  cycleSubmissionId: string | null;
  cycleWindowId: string | null;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function ahead(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function patient(id: string, pseudonym: string, extra: Partial<PatientRow> = {}): PatientRow {
  return {
    id,
    pseudonym,
    phase: "during",
    language: "en",
    canGetPregnant: true,
    homeTestingAllowed: true,
    latest: null,
    enrolled: true,
    cycleStatus: null,
    ...extra,
  };
}

function request(id: string, patientId: string, pseudonym: string, requestedAgo: number): RefillRequest {
  return {
    id,
    patientId,
    pseudonym,
    status: "requested",
    requestedAt: ago(requestedAgo),
    hasEmail: true,
    declineReason: null,
  };
}

function card(
  id: string,
  pseudonym: string,
  overrides: Partial<Omit<QueueCard, "grok">> & { grok?: Partial<QueueCard["grok"]> },
): QueueCard {
  const { grok, ...rest } = overrides;
  return {
    submissionId: id,
    status: "ready_for_review",
    capturedAt: ago(25 * 60 * 1000),
    patient: { pseudonym, phase: "during", language: "en" },
    photoUrl: null,
    grok: {
      result: "negative",
      code: null,
      confidence: 0.96,
      codeMatches: true,
      controlLine: true,
      testLine: "none",
      ...grok,
    },
    opencv: { result: "negative", confidence: 0.93 },
    readersAgree: true,
    flags: [],
    window: null,
    canReview: true,
    ...rest,
  };
}

export function seed(): MockDb {
  return {
    patientSignedIn: false,
    patientEnrolled: true,
    cycle: null,
    requests: [
      request("mock-req-2231", "mock-patient-2231", "PT-2231", 2 * HOUR),
      request("mock-req-3310", "mock-patient-3310", "PT-3310", 5 * HOUR),
      request("mock-req-4477", "mock-patient-4477", "PT-4477", 26 * HOUR),
      request("mock-req-5120", "mock-patient-5120", "PT-5120", 40 * 60 * 1000),
      {
        ...request("mock-req-6604", "mock-patient-6604", "PT-6604", 3 * DAY),
        hasEmail: false,
      },
    ],
    raceOnce: ["PT-4477"],
    enrolledPatientIds: [DEMO_PATIENT.id, "mock-patient-2231", "mock-patient-3310", "mock-patient-4477", "mock-patient-5120", "mock-patient-6604"],
    patients: [
      patient(DEMO_PATIENT.id, DEMO_PATIENT.pseudonym),
      patient("mock-patient-2231", "PT-2231", { language: "es" }),
      patient("mock-patient-3310", "PT-3310"),
      patient("mock-patient-4477", "PT-4477"),
      patient("mock-patient-5120", "PT-5120"),
      patient("mock-patient-6604", "PT-6604"),
      patient("mock-patient-7788", "PT-7788", { phase: "pre", homeTestingAllowed: false }),
      patient("mock-patient-8012", "PT-8012", { canGetPregnant: false, homeTestingAllowed: false }),
    ],
    windows: [
      {
        id: "mock-window-a",
        patientId: "mock-patient-9001",
        pseudonym: "PT-9001",
        isFirstRx: false,
        opensAt: ago(6 * DAY),
        closesAt: ahead(20 * HOUR),
        filledAt: null,
        status: "open",
      },
      {
        id: "mock-window-b",
        patientId: "mock-patient-9002",
        pseudonym: "PT-9002",
        isFirstRx: true,
        opensAt: ago(2 * DAY),
        closesAt: ahead(5 * DAY),
        filledAt: null,
        status: "open",
      },
      {
        id: "mock-window-c",
        patientId: "mock-patient-9003",
        pseudonym: "PT-9003",
        isFirstRx: true,
        opensAt: ago(9 * DAY),
        closesAt: ago(2 * DAY),
        filledAt: null,
        status: "missed",
      },
    ],
    queue: [
      card("mock-sub-faint", "PT-5561", {
        status: "needs_review",
        grok: { result: "negative", confidence: 0.81, testLine: "faint" },
        flags: ["faint_test_line", "low_confidence"],
      }),
      card("mock-sub-clean", "PT-4410", {}),
      card("mock-sub-degraded", "PT-3902", {
        status: "needs_review",
        opencv: { result: null, confidence: null },
        readersAgree: false,
        flags: ["opencv_unavailable", "reuse_check_unavailable", "only one reader returned a result"],
      }),
      card("mock-sub-unknown", "PT-2777", {
        grok: { confidence: 0.9 },
        flags: ["glare_detected"],
      }),
    ],
    cycleSubmissionId: null,
    cycleWindowId: null,
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : (globalThis.localStorage ?? null);
  } catch {
    return null;
  }
}

let memory: MockDb | null = null;

export function load(): MockDb {
  const store = storage();
  if (store) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as MockDb;
    } catch {
      // Unreadable or blocked storage: fall back to memory.
    }
  }
  memory ??= seed();
  return memory;
}

export function save(db: MockDb): void {
  memory = db;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Quota or privacy mode; memory still holds it for this tab.
  }
}

export function update<T>(change: (db: MockDb) => T): T {
  const db = load();
  const result = change(db);
  save(db);
  return result;
}

export function reset(): void {
  memory = null;
  const store = storage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function stamp(cycle: Cycle, status: CycleStatus): Cycle {
  return { ...cycle, status, timestamps: { ...cycle.timestamps, [status]: new Date().toISOString() } };
}

export { ago, ahead, DAY, HOUR };
