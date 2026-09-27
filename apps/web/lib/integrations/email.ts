// Adapter: send one email to a patient. Owner of the real logic: Nihalika (Resend).
//
// Same shape as lib/integrations/audit.ts. This file is the seam: routes call `send()`
// and never import a mail SDK, so the Resend integration can land without touching any
// route, and this repo can run with no mail provider configured at all.
//
// Expected contract for the implementation:
//   send({ to, subject, text, replyTo? }): Promise<SendResult>
//     - resolves { ok: true, id } when the provider accepted it
//     - resolves { ok: false, reason } when it did not
//     - never throws, and never blocks the clinic action that triggered it
//
// Best effort by design. A clinician issuing a test link must succeed even when email is
// down; the link is still shown on screen for them to hand over or copy. Losing an email
// is an inconvenience, losing the link issue is a patient who cannot test today.
//
// Deliberately plain text and no template engine: an email in this system carries a link
// and a sentence, and the less of a patient's clinical state it repeats, the better.
import "server-only";

export type OutgoingEmail = {
  /** The patient's contact_email. Never a pseudonym, never an id. */
  to: string;
  subject: string;
  /** Plain text. Keep clinical detail out of it; the portal is where status lives. */
  text: string;
  replyTo?: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Send one email, best effort.
 *
 * Until the Resend implementation lands this is a no-op that reports why, so every call
 * site can already be written, tested and reasoned about. It logs the recipient's domain
 * only: an unsent email should not put a patient's address in the server logs.
 */
export async function send(email: OutgoingEmail): Promise<SendResult> {
  const domain = email.to.includes("@") ? email.to.slice(email.to.lastIndexOf("@")) : "(malformed)";
  console.warn("[email] not sent: no provider configured", { domain, subject: email.subject });
  return { ok: false, reason: "email_not_configured" };
}

/** True once a provider is wired up. Call sites use it to word the UI honestly. */
export function isConfigured(): boolean {
  return false;
}
