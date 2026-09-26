import type { QueueCard } from "@/lib/clinic/queue";

export function makeCard(overrides: Partial<QueueCard> = {}): QueueCard {
  return {
    submissionId: "13000000-0000-0000-0000-000000000001",
    status: "ready_for_review",
    capturedAt: "2026-09-26T09:00:00Z",
    patient: { pseudonym: "PT-1042", phase: "during", language: "en" },
    photoUrl: null,
    grok: { result: "negative", code: "K7Q2", confidence: 0.94, codeMatches: true },
    opencv: { result: "negative", confidence: 0.91 },
    readersAgree: true,
    flags: [],
    window: null,
    canReview: true,
    ...overrides,
  };
}
