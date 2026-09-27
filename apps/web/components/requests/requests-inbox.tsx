"use client";

// Refill requests inbox (PRD R4–R6). Approving sends the patient their one-time test link by
// email; the email outcome shows as a badge. A failed email stays listed with Resend until it
// goes out. Polled like the review queue, with an in-flight guard.
import { CheckIcon, InboxIcon, Loader2Icon, MailIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { approveRefillRequest, declineRefillRequest, listRefillRequests, resendTestLink } from "@/lib/api/client";
import type { EmailStatus, RefillRequest } from "@/lib/api/contracts";
import { BADGE_TONE_CLASS, EMAIL_BADGE } from "@/lib/cycle/copy";
import { cn } from "@/lib/utils";

export const INBOX_REFRESH_MS = 10_000;
export const DECLINE_REASON_MAX = 500;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function describeAge(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h ago`;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; code: string }
  | { kind: "ready"; pending: RefillRequest[]; failed: RefillRequest[]; refreshFailed: boolean };

type Handled = { request: RefillRequest; outcome: { kind: "approved"; emailStatus: EmailStatus; resent?: boolean } | { kind: "declined" } };

export function RequestsInbox() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [handled, setHandled] = useState<Handled[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const load = useCallback(async (mode: "initial" | "background") => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [pending, failed] = await Promise.all([
        listRefillRequests({ status: "requested" }),
        listRefillRequests({ status: "approved", emailStatus: "failed" }),
      ]);
      setNow(Date.now());
      if (!pending.ok || !failed.ok) {
        const code = !pending.ok ? pending.error.code : !failed.ok ? failed.error.code : "server_error";
        setState((s) =>
          mode === "background" && s.kind === "ready" && code !== "unauthenticated" ? { ...s, refreshFailed: true } : { kind: "error", code },
        );
        return;
      }
      setState({ kind: "ready", pending: pending.data, failed: failed.data, refreshFailed: false });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load("initial");
    const refresh = () => {
      if (!document.hidden) void load("background");
    };
    const timer = setInterval(refresh, INBOX_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  function stale(message: string) {
    setNotice(message);
    void load("background");
  }

  function settle(request: RefillRequest, outcome: Handled["outcome"]) {
    setHandled((h) => [{ request, outcome }, ...h.filter((x) => x.request.id !== request.id)]);
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            pending: s.pending.filter((r) => r.id !== request.id),
            failed:
              outcome.kind === "approved" && outcome.emailStatus === "failed"
                ? [...s.failed.filter((r) => r.id !== request.id), { ...request, status: "approved", emailStatus: "failed" }]
                : s.failed.filter((r) => r.id !== request.id),
          }
        : s,
    );
  }

  if (state.kind === "loading") {
    return (
      <div aria-busy="true" className="space-y-3">
        <span className="sr-only">Loading refill requests</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} data-testid="requests-skeleton" className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (state.kind === "error") return <InboxError code={state.code} onRetry={() => { setState({ kind: "loading" }); void load("initial"); }} />;

  const recent = handled.filter((h) => !(h.outcome.kind === "approved" && h.outcome.emailStatus === "failed"));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-mist">
          <span className="tabular font-semibold">{state.pending.length}</span>{" "}
          <span className="text-haze">{state.pending.length === 1 ? "request waiting" : "requests waiting"}</span>
        </p>
        {state.refreshFailed ? (
          <span role="status" className="text-warn">
            Couldn&apos;t refresh just now; showing the last loaded list.
          </span>
        ) : (
          <span className="text-haze">Updates every {INBOX_REFRESH_MS / 1000} s</span>
        )}
      </div>

      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-orchid/40 bg-orchid/10 px-4 py-3 text-sm text-mist">
          <span>{notice}</span>
          <button type="button" className="text-haze underline hover:text-mist" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {state.failed.length > 0 ? (
        <section aria-labelledby="failed-title" className="space-y-3">
          <h2 id="failed-title" className="flex items-center gap-2 text-lg font-semibold text-mist">
            <TriangleAlertIcon className="size-4 text-stop" aria-hidden />
            Link email didn&apos;t send
          </h2>
          <ul className="space-y-3">
            {state.failed.map((request) => (
              <li key={request.id}>
                <FailedEmailRow request={request} now={now} onSettled={settle} onStale={stale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="pending-title" className="space-y-3">
        <h2 id="pending-title" className="text-lg font-semibold text-mist">
          Waiting for approval
        </h2>
        {state.pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <InboxIcon className="mx-auto size-6 text-haze" aria-hidden />
            <p className="mt-3 font-display text-xl font-semibold text-mist">No requests waiting</p>
            <p className="mt-2 text-sm text-haze">
              When a patient requests a refill from their portal, it appears here within seconds.
            </p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Requests waiting for approval">
            <AnimatePresence initial={false}>
              {state.pending.map((request) => (
                <m.li
                  key={request.id}
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 40, transition: { duration: 0.25 } }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <PendingRow request={request} now={now} onSettled={settle} onStale={stale} />
                </m.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section aria-labelledby="handled-title" className="space-y-3">
          <h2 id="handled-title" className="text-lg font-semibold text-mist">
            Handled just now
          </h2>
          <ul className="space-y-2">
            {recent.map(({ request, outcome }) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm"
              >
                <span className="font-semibold text-mist">{request.pseudonym}</span>
                {outcome.kind === "declined" ? (
                  <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", BADGE_TONE_CLASS.neutral)}>Declined</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-haze">{outcome.resent ? "Link resent" : "Approved"}</span>
                    <EmailBadge status={outcome.emailStatus} />
                  </span>
                )}
                {outcome.kind === "approved" && outcome.emailStatus === "disabled" ? (
                  <p className="w-full text-xs text-haze">{EMAIL_BADGE.disabled.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function EmailBadge({ status }: { status: EmailStatus }) {
  const badge = EMAIL_BADGE[status];
  return (
    <span
      data-email-status={status}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", BADGE_TONE_CLASS[badge.tone])}
    >
      <MailIcon className="size-3.5" aria-hidden />
      {badge.label}
    </span>
  );
}

function InboxError({ code, onRetry }: { code: string; onRetry: () => void }) {
  if (code === "unauthenticated") {
    return (
      <Alert>
        <AlertTitle>Sign in required</AlertTitle>
        <AlertDescription>
          Sign in to see refill requests. <Link className="underline" href="/login">Go to sign in</Link>
        </AlertDescription>
      </Alert>
    );
  }
  if (code === "not_a_clinician") {
    return (
      <Alert>
        <AlertTitle>No clinic access</AlertTitle>
        <AlertDescription>This account is not a clinician at a practice.</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" role="alert">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{code === "not_available" ? "Refill requests aren't available yet" : "Could not load refill requests"}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {code === "not_available"
            ? "The server doesn't have the refill-requests endpoint yet."
            : "Check your connection and try again."}
        </p>
        <Button variant="outline" onClick={onRetry}>
          <RefreshCwIcon aria-hidden /> Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

const ROW_ERRORS: Record<string, string> = {
  unauthenticated: "Your session expired. Sign in again.",
  not_a_clinician: "This account can't handle refill requests.",
  network_error: "Network error. Check your connection and try again.",
  reason_required: "Add a reason for declining.",
};

function rowError(code: string, action: "approve" | "decline" | "resend"): string {
  return ROW_ERRORS[code] ?? `Could not ${action}. Try again.`;
}

type RowProps = {
  request: RefillRequest;
  now: number;
  onSettled: (request: RefillRequest, outcome: Handled["outcome"]) => void;
  onStale: (message: string) => void;
};

function RequestSummary({ request, now }: { request: RefillRequest; now: number }) {
  const waitingLong = now - Date.parse(request.requestedAt) > DAY;
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-lg font-semibold text-mist">{request.pseudonym}</p>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-haze">
        <span>
          Requested{" "}
          <time dateTime={request.requestedAt} title={new Date(request.requestedAt).toLocaleString()}>
            {describeAge(request.requestedAt, now)}
          </time>
        </span>
        {waitingLong ? <span className="font-medium text-warn">· waiting over a day</span> : null}
      </p>
    </div>
  );
}

function PendingRow({ request, now, onSettled, onStale }: RowProps) {
  const [pending, setPending] = useState<"approve" | "decline" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonId = `decline-reason-${request.id}`;

  async function approve() {
    setPending("approve");
    setError(null);
    const result = await approveRefillRequest(request.id);
    setPending(null);
    if (result.ok) {
      onSettled(request, { kind: "approved", emailStatus: result.data.emailStatus });
      return;
    }
    if (result.error.code === "not_pending") return onStale(`${request.pseudonym}'s request was already handled by someone else. The list is up to date.`);
    if (result.error.code === "not_found") return onStale(`${request.pseudonym}'s request no longer exists. The list is up to date.`);
    setError(rowError(result.error.code, "approve"));
  }

  async function decline() {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setPending("decline");
    setError(null);
    const result = await declineRefillRequest(request.id, trimmed);
    setPending(null);
    if (result.ok) {
      onSettled(request, { kind: "declined" });
      return;
    }
    if (result.error.code === "not_pending") return onStale(`${request.pseudonym}'s request was already handled by someone else. The list is up to date.`);
    if (result.error.code === "not_found") return onStale(`${request.pseudonym}'s request no longer exists. The list is up to date.`);
    setError(rowError(result.error.code, "decline"));
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-busy={pending !== null}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <RequestSummary request={request} now={now} />
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            size="lg"
            className="flex-1 sm:flex-none"
            disabled={pending !== null}
            onClick={approve}
            aria-label={`Approve refill request for ${request.pseudonym}`}
          >
            {pending === "approve" ? (
              <>
                <Loader2Icon className="animate-spin" aria-hidden /> Approving…
              </>
            ) : (
              <>
                <CheckIcon aria-hidden /> Approve
              </>
            )}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={pending !== null}
            aria-expanded={declining}
            aria-controls={reasonId}
            onClick={() => setDeclining((v) => !v)}
            aria-label={`Decline refill request for ${request.pseudonym}`}
          >
            Decline
          </Button>
        </div>
      </div>
      <p className="text-xs text-haze">Approving emails the patient a one-time test link.</p>
      {declining ? (
        <form
          id={reasonId}
          className="space-y-2 rounded-lg border border-line bg-ink/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void decline();
          }}
        >
          <label htmlFor={`${reasonId}-text`} className="text-sm font-medium">
            Reason for declining (required, the patient sees it)
          </label>
          <Textarea
            id={`${reasonId}-text`}
            value={reason}
            maxLength={DECLINE_REASON_MAX}
            required
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Please book a clinic visit before your next refill"
            disabled={pending !== null}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" disabled={pending !== null || !reason.trim()}>
              {pending === "decline" ? (
                <>
                  <Loader2Icon className="animate-spin" aria-hidden /> Declining…
                </>
              ) : (
                "Confirm decline"
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(false)} disabled={pending !== null}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-stop">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FailedEmailRow({ request, now, onSettled, onStale }: RowProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setPending(true);
    setError(null);
    const result = await resendTestLink(request.id);
    setPending(false);
    if (result.ok) {
      if (result.data.emailStatus === "failed") {
        setError("The email still didn't send. Check the email setup, or ask the patient to start from their portal.");
        return;
      }
      onSettled(request, { kind: "approved", emailStatus: result.data.emailStatus, resent: true });
      return;
    }
    if (result.error.code === "not_resendable" || result.error.code === "not_found") {
      return onStale(`${request.pseudonym}'s link can't be resent any more. The list is up to date.`);
    }
    setError(rowError(result.error.code, "resend"));
  }

  return (
    <div className="space-y-2 rounded-2xl border border-stop/40 bg-surface p-4 sm:p-5" aria-busy={pending}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <RequestSummary request={request} now={now} />
          <EmailBadge status="failed" />
        </div>
        <Button
          size="lg"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={pending}
          onClick={resend}
          aria-label={`Resend link to ${request.pseudonym}`}
        >
          {pending ? (
            <>
              <Loader2Icon className="animate-spin" aria-hidden /> Resending…
            </>
          ) : (
            <>
              <RefreshCwIcon aria-hidden /> Resend link
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-haze">Resending retires the old link and emails a new one.</p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-stop">
          {error}
        </p>
      ) : null}
    </div>
  );
}
