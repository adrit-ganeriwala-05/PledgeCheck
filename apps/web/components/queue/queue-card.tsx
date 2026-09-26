"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QueueCard as QueueCardData } from "@/lib/clinic/queue";
import { cn } from "@/lib/utils";

import { FlagBadges } from "./flag-badges";
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
};

// One card holds the whole decision: photo, both reads, flags, window and the actions.
export function QueueCard({ card, onResolved }: Props) {
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
  const reasons = needsReview ? closerReviewReasons(card) : [];

  return (
    <Card
      role="group"
      aria-labelledby={`card-title-${card.submissionId}`}
      data-status={card.status}
      tabIndex={card.canReview ? 0 : undefined}
      onKeyDown={handleKeyDown}
      aria-keyshortcuts={card.canReview ? "A R" : undefined}
      className={cn(
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        needsReview && "border-2 border-amber-500 bg-amber-50/60 dark:border-amber-600 dark:bg-amber-950/30",
      )}
    >
      <CardHeader>
        {needsReview ? (
          <div className="mb-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-amber-950 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100">
            <p className="flex items-center gap-1.5 font-semibold">
              <TriangleAlertIcon className="size-4" aria-hidden />
              Needs closer review
            </p>
            {reasons.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-sm">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="mb-1 text-sm font-medium text-muted-foreground">Ready for review</p>
        )}
        <CardTitle id={`card-title-${card.submissionId}`} className="flex flex-wrap items-center gap-2">
          <span>{card.patient.pseudonym}</span>
          <span className="text-sm font-normal text-muted-foreground">
            phase {card.patient.phase} · {card.patient.language.toUpperCase()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PhotoViewer url={card.photoUrl} pseudonym={card.patient.pseudonym} />
        <div className="space-y-4">
          <ReadersPanel card={card} />
          <FlagBadges flags={card.flags} />
          <WindowCountdown window={card.window} capturedAt={card.capturedAt} />
          {card.canReview ? (
            <>
              <ReviewActions
                ref={actions}
                submissionId={card.submissionId}
                pseudonym={card.patient.pseudonym}
                onDone={handleDone}
              />
              <p className="text-xs text-muted-foreground">
                Shortcuts when this card is focused: <kbd className="font-mono">A</kbd> approve ·{" "}
                <kbd className="font-mono">R</kbd> reject
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Read-only: only prescribers can approve or reject.</p>
          )}
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
