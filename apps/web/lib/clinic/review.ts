import { z } from "zod";

// Provisional (pending team decision): a reason is required to reject and optional to
// approve. Change here only.
export const REJECT_REASON_REQUIRED = true;
export const REASON_MAX_LENGTH = 500;

export const REVIEWABLE_STATUSES = ["ready_for_review", "needs_review"] as const;

export const reviewBodySchema = z
  .object({
    // z.guid(): any 8-4-4-4-12 hex id (seeded ids are not RFC-4122 versioned).
    submissionId: z.guid(),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(REASON_MAX_LENGTH).optional(),
  })
  .transform((body) => ({ ...body, reason: body.reason ? body.reason : undefined }))
  .superRefine((body, ctx) => {
    if (REJECT_REASON_REQUIRED && body.decision === "rejected" && !body.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "reason is required to reject" });
    }
  });

export type ReviewBody = z.infer<typeof reviewBodySchema>;

// public.submit_review returns this shape (db/functions.sql).
export const submitReviewResultSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  window: z
    .object({ opens_at: z.string(), closes_at: z.string(), is_first_rx: z.boolean() })
    .nullable(),
});

// Error codes raised by public.submit_review (db/functions.sql) and the HTTP answer for each.
export function mapSubmitReviewError(code: string | undefined): { status: number; error: string } {
  switch (code) {
    case "P0002":
      return { status: 404, error: "not_found" };
    case "42501":
      return { status: 403, error: "forbidden" };
    case "PC409":
      return { status: 409, error: "not_reviewable" };
    case "23505":
      return { status: 409, error: "already_reviewed" };
    default:
      if (code?.startsWith("22")) return { status: 400, error: "invalid_request" };
      return { status: 500, error: "review_failed" };
  }
}
