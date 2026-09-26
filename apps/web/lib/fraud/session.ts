// Link and session states. No schema change: test_requests.used_at records when the
// patient tapped Start ("link consumed: session started"), and the session ends
// SESSION_MINUTES later.
//
//   ready            not started, now < expires_at
//   active           started, now < used_at + SESSION_MINUTES
//   session_expired  started, now >= used_at + SESSION_MINUTES
//   link_expired     not started, now >= expires_at
//   submitted        a submission with a photo already exists (checked first)

export const SESSION_MINUTES = 40;
export const LINK_TTL_HOURS = 24;

export type LinkState = "ready" | "active" | "session_expired" | "link_expired" | "submitted";

export type LinkStateInput = {
  expires_at: string | Date;
  used_at: string | Date | null;
  /** True when a submissions row with a photo exists for this request. */
  submitted: boolean;
};

export function linkExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + LINK_TTL_HOURS * 60 * 60 * 1000);
}

export function sessionEndsAt(request: Pick<LinkStateInput, "used_at">): Date | null {
  if (request.used_at == null) return null;
  return new Date(new Date(request.used_at).getTime() + SESSION_MINUTES * 60 * 1000);
}

export function linkState(request: LinkStateInput, now: Date): LinkState {
  if (request.submitted) return "submitted";
  const endsAt = sessionEndsAt(request);
  if (endsAt) return now.getTime() < endsAt.getTime() ? "active" : "session_expired";
  return now.getTime() < new Date(request.expires_at).getTime() ? "ready" : "link_expired";
}
