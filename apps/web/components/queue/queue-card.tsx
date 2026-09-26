"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { QueueCard as QueueCardData } from "@/lib/clinic/queue";

import { PhotoViewer } from "./photo-viewer";
import { ReadersPanel } from "./readers-panel";
import { ReviewActions, type ReviewOutcome } from "./review-actions";
import { WindowCountdown } from "./window-countdown";

const REVIEW_ERRORS: Record<string, string> = {
  window_logic_unavailable: "The pickup-window logic isn't connected yet, so nothing was saved. Tell the team.",
  already_reviewed: "Someone already reviewed this test.",
  not_reviewable: "This test can no longer be reviewed.",
  not_found: "This test no longer exists or belongs to another practice.",
  prescriber_only: "Only prescribers can approve or reject.",
  unauthenticated: "Your session expired. Sign in again.",
};

type Props = { card: QueueCardData; onReviewed: (outcome: ReviewOutcome & { ok: true }) => void };

// One card holds the whole decision: photo, both reads, flags, window and the actions.
export function QueueCard({ card, onReviewed }: Props) {
  const [error, setError] = useState<string | null>(null);

  function handleDone(outcome: ReviewOutcome) {
    if (outcome.ok) {
      setError(null);
      onReviewed(outcome);
      return;
    }
    setError(
      outcome.reviewRecorded
        ? "Decision saved, but a follow-up step failed. Tell the team."
        : (REVIEW_ERRORS[outcome.error] ?? "Could not save the decision. Try again."),
    );
  }

  return (
    <Card aria-labelledby={`card-title-${card.submissionId}`}>
      <CardHeader>
        <CardTitle id={`card-title-${card.submissionId}`} className="flex flex-wrap items-center gap-2">
          <span>{card.patient.pseudonym}</span>
          <Badge variant="outline">{card.status === "needs_review" ? "Needs closer review" : "Ready for review"}</Badge>
          <span className="text-sm font-normal text-muted-foreground">
            phase {card.patient.phase} · {card.patient.language.toUpperCase()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PhotoViewer url={card.photoUrl} pseudonym={card.patient.pseudonym} />
        <div className="space-y-4">
          <ReadersPanel card={card} />
          {card.flags.length > 0 ? (
            <ul aria-label="Flags" className="flex flex-wrap gap-1.5">
              {card.flags.map((flag) => (
                <li key={flag}>
                  <Badge variant="secondary">{flag}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <WindowCountdown window={card.window} capturedAt={card.capturedAt} />
          {card.canReview ? (
            <ReviewActions submissionId={card.submissionId} pseudonym={card.patient.pseudonym} onDone={handleDone} />
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
