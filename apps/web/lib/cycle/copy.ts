// One wording for each cycle status: what the patient reads in the portal, and the badge the
// clinic sees. Patient copy never mentions a result, a reader or a fraud check.

import type { Cycle, CycleStatus, EmailStatus } from "@/lib/api/contracts";

// No "start_test": the backend has no endpoint that hands a patient a link, so the only
// way to a test is the emailed one. Offering a button that cannot work would be worse
// than saying plainly where the link is.
export type PatientAction = "request_refill" | "request_again" | null;

export type PatientView = {
  /** Stable id for the view, used by tests and data attributes. */
  key: string;
  title: string;
  body: string;
  action: PatientAction;
};

export const NO_CYCLE_VIEW: PatientView = {
  key: "none",
  title: "Ready for this month's check",
  body: "Request a refill when you're ready for your monthly test. Your clinic looks at every request first.",
  action: "request_refill",
};

/** The portal view for a cycle. Exits and email outcomes get their own views. */
export function patientView(cycle: Cycle | null): PatientView {
  if (!cycle) return NO_CYCLE_VIEW;
  switch (cycle.status) {
    case "requested":
      return {
        key: "requested",
        title: "Waiting for your clinic",
        body: "Your clinic has your request. Once they approve it, we'll email you a link for your test.",
        action: null,
      };
    case "declined":
      return {
        key: "declined",
        title: "Your clinic declined this request",
        body: cycle.canRequestAgain
          ? "You can send a new request when you're ready."
          : "Contact your clinic before you request again.",
        action: cycle.canRequestAgain ? "request_again" : null,
      };
    case "approved":
      return approvedView(cycle.emailStatus);
    case "submitted":
    case "in_review":
      return {
        key: "submitted",
        title: "Submitted, your clinic will review it",
        body: "We'll email you when your clinic has looked at it. There's nothing else to do right now.",
        action: null,
      };
    case "rejected":
      return {
        key: "rejected",
        title: "Your clinic asked for a new test",
        body: "Your clinic will be in touch about the next step. Any new test link comes to your email.",
        action: null,
      };
    case "window_open":
      return {
        key: "window_open",
        title: "Your prescription is ready for pickup",
        body: "Pick it up from your pharmacy before the deadline below.",
        action: null,
      };
    case "picked_up":
      return {
        key: "picked_up",
        title: "This month is complete",
        body: "Your prescription was picked up. Request next month's refill when it's time.",
        action: "request_refill",
      };
    case "missed":
      return {
        key: "missed",
        title: "Your pickup window closed",
        body: "The deadline passed before pickup. Contact your clinic to find out what to do next.",
        action: null,
      };
    case "expired":
      return {
        key: "expired",
        title: "This request expired",
        body: "The test link ran out before a test was taken. You can request a new refill when you're ready.",
        action: "request_again",
      };
  }
}

function approvedView(emailStatus: EmailStatus | null): PatientView {
  if (emailStatus === "failed") {
    return {
      key: "approved_email_failed",
      title: "Your clinic is resending your link",
      body: "Your request was approved, but the email didn't go through. Your clinic has been told and will send it again.",
      action: null,
    };
  }
  if (emailStatus === "disabled") {
    return {
      key: "approved_no_email",
      title: "Your test link is ready",
      body: "Your clinic approved your request. Your clinic will pass on your test link directly.",
      action: null,
    };
  }
  return {
    key: "approved",
    title: "Check your email for your test link",
    body: "Your clinic approved your request. The email is from PledgeCheck. Take your test, then open the link. If you can't find it, check your spam folder or ask your clinic to send it again.",
    action: null,
  };
}

/** The steps a patient sees, in order. An exit replaces the step it ends on. */
export const TIMELINE_STEPS = [
  { status: "requested", label: "Refill requested" },
  { status: "approved", label: "Clinic approved" },
  { status: "submitted", label: "Test sent" },
  { status: "in_review", label: "Clinic review" },
  { status: "window_open", label: "Ready for pickup" },
  { status: "picked_up", label: "Picked up" },
] as const satisfies readonly { status: CycleStatus; label: string }[];

const EXIT_STEP: Partial<Record<CycleStatus, { index: number; label: string }>> = {
  declined: { index: 1, label: "Declined" },
  rejected: { index: 3, label: "New test needed" },
  missed: { index: 5, label: "Window closed" },
  expired: { index: 2, label: "Link expired" },
};

export type TimelineStep = {
  label: string;
  state: "done" | "current" | "upcoming" | "exit";
  at: string | null;
};

export function timeline(cycle: Cycle): TimelineStep[] {
  const exit = EXIT_STEP[cycle.status];
  const currentIndex = exit ? exit.index : TIMELINE_STEPS.findIndex((s) => s.status === cycle.status);
  return TIMELINE_STEPS.map((step, i) => {
    if (exit && i === exit.index) return { label: exit.label, state: "exit", at: cycle.timestamps[cycle.status] ?? null };
    const at = cycle.timestamps[step.status] ?? null;
    if (i < currentIndex) return { label: step.label, state: "done", at };
    if (i === currentIndex) return { label: step.label, state: cycle.status === "picked_up" ? "done" : "current", at };
    return { label: step.label, state: "upcoming", at: null };
  });
}

// ---------------------------------------------------------------------------
// Clinic badges
// ---------------------------------------------------------------------------

export type BadgeTone = "neutral" | "info" | "ok" | "warn" | "stop";

export const CLINIC_CYCLE_BADGE: Record<CycleStatus, { label: string; tone: BadgeTone }> = {
  requested: { label: "Refill requested", tone: "info" },
  approved: { label: "Link sent", tone: "info" },
  submitted: { label: "Photo submitted", tone: "info" },
  in_review: { label: "In review", tone: "warn" },
  window_open: { label: "Pickup window open", tone: "ok" },
  picked_up: { label: "Picked up", tone: "ok" },
  declined: { label: "Request declined", tone: "neutral" },
  rejected: { label: "Result rejected", tone: "stop" },
  missed: { label: "Window missed", tone: "stop" },
  expired: { label: "Link expired", tone: "neutral" },
};

export const EMAIL_BADGE: Record<EmailStatus, { label: string; tone: BadgeTone; detail: string }> = {
  sent: { label: "Email sent", tone: "ok", detail: "The patient has their test link." },
  failed: {
    label: "Email failed",
    tone: "stop",
    detail: "The link email didn't go out. The link exists; pass it to the patient another way.",
  },
  disabled: {
    label: "Email off",
    tone: "warn",
    detail: "No email was sent: this patient has no address on file. The link exists; pass it on yourself.",
  },
};

export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "border-line text-haze",
  info: "border-orchid/40 bg-orchid/10 text-orchid-text",
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/45 bg-warn/10 text-warn",
  stop: "border-stop/50 bg-stop/10 text-stop",
};
