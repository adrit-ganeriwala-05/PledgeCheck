// Send one email through Resend's HTTP API (https://resend.com/docs/api-reference/emails).
// Plain fetch, no SDK. Server-only: reads RESEND_API_KEY.
import "server-only";

import { serverEnv } from "@/lib/env";

const RESEND_URL = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export class EmailSendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmailSendError";
  }
}

// Returns Resend's message id. Throws EmailSendError on any failure. Never logs the
// message body: it may carry a one-time link.
export async function sendEmail(message: EmailMessage): Promise<{ id: string }> {
  // Read outside the try so a missing variable surfaces as MissingEnvError, by name.
  const apiKey = serverEnv.RESEND_API_KEY;
  const from = serverEnv.EMAIL_FROM;

  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new EmailSendError("email request failed", { cause: err });
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") detail = `: ${body.message}`;
    } catch {
      // Non-JSON error body; the status is enough.
    }
    throw new EmailSendError(`email rejected (${res.status})${detail}`);
  }

  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new EmailSendError("email response had no id");
  return { id: body.id };
}
