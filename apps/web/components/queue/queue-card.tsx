"use client";

import { CircleDashedIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { describeAgreement } from "@/lib/clinic/format";
import type { QueueCard as QueueCardData } from "@/lib/clinic/queue";
import { cn } from "@/lib/utils";

import { FlagBadges } from "./flag-badges";
import { degradedNotes, flagLabel, flagSeverity } from "./flags";
import { PhotoViewer } from "./photo-viewer";
import { ReadersPanel } from "./readers-panel";
import { ReviewActions, type ReviewActionsHandle, type ReviewOutcome } from "./review-actions";
import { closerReviewReasons } from "./review-reasons";
import { WindowCountdown } from "./window-countdown";

const REVIEW_ERRORS: Record<string, string> = {
  window_logic_unavailable: "The pickup-window logic isn't connected yet, so nothing was saved. Tell the team.",
  already_reviewed: "Someone already reviewed this test.",
  not_reviewable: "This test can no longer be reviewed.",
  not_found: "This test no longer exists or belongs to another practice.",
  prescriber_only: "Only prescribers can approve or reject.",
  unauthenticated: "Your session expired. Sign in again.",
};

type Props = {
  card: QueueCardData;
  // Called when the decision was saved (fully, or with a failed follow-up step).
  onResolved: (outcome: ReviewOutcome) => void;
  /** Arrived after the queue first loaded; highlighted briefly. */
  isNew?: boolean;
};

// One card holds the whole decision: photo, both reads, flags, window and the actions.
export function QueueCard({ card, onResolved, isNew = false }: Props) {
  const [error, setError] = useState<string | null>(null);

  function handleDone(outcome: ReviewOutcome) {
    if (outcome.ok || outcome.reviewRecorded) {
      setError(null);
      onResolved(outcome);
      return;
    }
    // Not saved: stay on the card so the prescriber can try again.
    setError(REVIEW_ERRORS[outcome.error] ?? "Could not save the decision. Try again.");
  }

  const actions = useRef<ReviewActionsHandle>(null);

  // Keyboard: A approves and R starts a rejection, only while the card itself has focus
  // (never while typing in the reason box or when a button inside has focus).
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!card.canReview || e.target !== e.currentTarget) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "a") {
      e.preventDefault();
      actions.current?.approve();
    } else if (key === "r") {
      e.preventDefault();
      actions.current?.startReject();
    }
  }

  const needsReview = card.status === "needs_review";
  const degraded = degradedNotes(card);
  // The degraded banner already says which reader or check did not run; don't repeat it here.
  const readerMissing = card.grok.result === null || card.opencv.result === null;
  const degradedLabels = new Set(
    card.flags.filter((f) => flagSeverity(f) === "degraded").map((f) => `Flag: ${flagLabel(f).label}`),
  );
  const missingReaderLine = readerMissing ? describeAgreement(card) : null;
  const reasons = (needsReview ? closerReviewReasons(card) : []).filter(
    (r) => !degradedLabels.has(r) && r !== missingReaderLine,
  );

  return (
    <div
      role="group"
      aria-labelledby={`card-title-${card.submissionId}`}
      data-status={card.status}
      data-queue-card
      data-new={isNew || undefined}
      tabIndex={card.canReview ? 0 : undefined}
      onKeyDown={handleKeyDown}
      aria-keyshortcuts={card.canReview ? "A R" : undefined}
      className={cn(
        "rounded-2xl border bg-surface p-4 text-mist transition-[box-shadow,border-color] duration-500 outline-none sm:p-5",
        "focus-visible:border-orchid focus-visible:shadow-[0_0_0_3px_color-mix(in_oklch,var(--orchid)_45%,transparent)]",
        needsReview ? "border-warn/50" : "border-line",
        isNew && "shadow-[0_0_0_1px_var(--orchid),0_0_40px_-8px_color-mix(in_oklch,var(--orchid)_60%,transparent)]",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {needsReview ? null : (
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-haze">
                <span className="size-1.5 rounded-full bg-haze" aria-hidden />
                Ready for review
              </p>
            )}
            {isNew ? (
              <span className="rounded-full bg-orchid/15 px-2 py-0.5 text-xs font-semibold text-orchid-text">New</span>
            ) : null}
          </div>
          <h2 id={`card-title-${card.submissionId}`} className="flex flex-wrap items-baseline gap-x-2 text-xl font-semibold">
            <span>{card.patient.pseudonym}</span>
            <span className="font-sans text-sm font-normal tracking-normal text-haze">
              phase {card.patient.phase} · {card.patient.language.toUpperCase()}
            </span>
          </h2>
        </div>
        <WindowCountdown window={card.window} capturedAt={card.capturedAt} />
      </header>

      {needsReview || degraded.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2.5 text-mist">
          {needsReview ? (
            <div>
              <p className="flex items-center gap-1.5 font-semibold text-warn">
                <TriangleAlertIcon className="size-4" aria-hidden />
                Needs closer review
              </p>
              {reasons.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm marker:text-warn">
                  {reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {degraded.length > 0 ? (
            <div role="note" aria-label="Checks that did not run" className="space-y-1">
              {degraded.map((note) => (
                <p key={note} className="flex items-start gap-1.5 text-sm font-medium text-warn">
                  <CircleDashedIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{note}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PhotoViewer url={card.photoUrl} pseudonym={card.patient.pseudonym} />
        <div className="space-y-3">
          <ReadersPanel card={card} />
          <FlagBadges flags={card.flags} />
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        {card.canReview ? (
          <ReviewActions
            ref={actions}
            submissionId={card.submissionId}
            pseudonym={card.patient.pseudonym}
            onDone={handleDone}
          />
        ) : (
          <p className="text-sm text-haze">Read-only: only prescribers can approve or reject.</p>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-stop">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
