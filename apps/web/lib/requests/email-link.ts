// Issue a one-time test link and email it to the patient. Called when a clinician approves
// a refill request.
//
// The link is issued (and its request.issued event written) before anything is sent. If
// the email then fails, the link is still returned with emailed: false so the clinician
// can fall back to copying it or showing the QR code. The patient's address is never
// written to the audit log.
import "server-only";

import { appendAuditEvent } from "@/lib/audit/append";
import { sendEmail } from "@/lib/email/send";
import { testLinkEmail } from "@/lib/email/test-link";

import { type IssueTestLinkFailure, type IssueTestLinkInput, issueTestLink } from "./issue";

export type EmailedTestLink = {
  ok: true;
  requestId: string;
  link: string;
  expiresAt: string;
  emailed: boolean;
};

export async function issueAndEmailTestLink(
  input: IssueTestLinkInput & { email: string },
): Promise<EmailedTestLink | IssueTestLinkFailure> {
  const issued = await issueTestLink(input);
  if (!issued.ok) return issued;

  const result = { ok: true as const, requestId: issued.requestId, link: issued.link, expiresAt: issued.expiresAt };

  let messageId: string;
  try {
    ({ id: messageId } = await sendEmail(
      testLinkEmail({
        to: input.email,
        link: issued.link,
        expiresAt: issued.expiresAt,
        language: issued.patient.language,
      }),
    ));
  } catch (err) {
    console.error("[requests] link email not sent", {
      requestId: issued.requestId,
      cause: err instanceof Error ? err.message : "unknown",
    });
    return { ...result, emailed: false };
  }

  // The email is already out; a missing event is logged, not surfaced as a failure.
  try {
    await appendAuditEvent({
      actor: `clinician:${input.clinician.id}`,
      action: "request.emailed",
      refId: issued.requestId,
      payload: { provider: "resend", messageId },
    });
  } catch (err) {
    console.error("[requests] request.emailed event not written", {
      requestId: issued.requestId,
      cause: err instanceof Error ? err.message : "unknown",
    });
  }

  return { ...result, emailed: true };
}
