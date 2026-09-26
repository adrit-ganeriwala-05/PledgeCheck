"use client";

import { Loader2Icon } from "lucide-react";
import { useImperativeHandle, useRef, useState, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { REASON_MAX_LENGTH } from "@/lib/clinic/review";

export type ReviewOutcome =
  | { ok: true; status: "approved" | "rejected"; window: { opensAt: string; closesAt: string } | null }
  | { ok: false; error: string; reviewRecorded: boolean };

export type ReviewActionsHandle = {
  approve: () => void;
  startReject: () => void;
};

type Props = {
  submissionId: string;
  pseudonym: string;
  onDone: (outcome: ReviewOutcome) => void;
  ref?: Ref<ReviewActionsHandle>;
};

export async function submitReview(submissionId: string, decision: "approved" | "rejected", reason?: string): Promise<ReviewOutcome> {
  try {
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId, decision, reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: body.status, window: body.window ?? null };
    return { ok: false, error: body.error ?? `http_${res.status}`, reviewRecorded: body.reviewRecorded === true };
  } catch {
    return { ok: false, error: "network_error", reviewRecorded: false };
  }
}

// Approve is one tap (no confirmation) so a clear case takes seconds; Reject asks for a reason.
export function ReviewActions({ submissionId, pseudonym, onDone, ref }: Props) {
  const [pending, setPending] = useState<"approved" | "rejected" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  async function decide(decision: "approved" | "rejected") {
    if (pending) return;
    setPending(decision);
    const outcome = await submitReview(submissionId, decision, decision === "rejected" ? reason.trim() : undefined);
    setPending(null);
    onDone(outcome);
  }

  useImperativeHandle(ref, () => ({
    approve: () => void decide("approved"),
    startReject: () => {
      setRejecting(true);
      // Focus after the textarea renders.
      setTimeout(() => reasonRef.current?.focus(), 0);
    },
  }));

  const reasonId = `reject-reason-${submissionId}`;

  return (
    <div className="space-y-3" aria-busy={pending !== null}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Button
            className="w-full"
            size="lg"
            disabled={pending !== null}
            onClick={() => decide("approved")}
            aria-label={`Approve test for ${pseudonym}`}
          >
            {pending === "approved" ? (
              <>
                <Loader2Icon className="animate-spin" aria-hidden /> Approving…
              </>
            ) : (
              "Approve"
            )}
          </Button>
          <p className="text-xs text-muted-foreground">Approve opens the 7-day pickup window and deletes the photo.</p>
        </div>
        <div className="space-y-1">
          <Button
            className="w-full"
            size="lg"
            variant="outline"
            disabled={pending !== null}
            aria-expanded={rejecting}
            aria-controls={reasonId}
            onClick={() => setRejecting((v) => !v)}
            aria-label={`Reject test for ${pseudonym}`}
          >
            Reject
          </Button>
          <p className="text-xs text-muted-foreground">Reject records your reason and deletes the photo; the clinic follows up.</p>
        </div>
      </div>

      {rejecting ? (
        <form
          id={reasonId}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) void decide("rejected");
          }}
        >
          <label htmlFor={`${reasonId}-text`} className="text-sm font-medium">
            Reason for rejecting (required)
          </label>
          <Textarea
            ref={reasonRef}
            id={`${reasonId}-text`}
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            required
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Test line unclear; repeat test in clinic"
            disabled={pending !== null}
          />
          <Button type="submit" variant="destructive" disabled={pending !== null || !reason.trim()}>
            {pending === "rejected" ? (
              <>
                <Loader2Icon className="animate-spin" aria-hidden /> Rejecting…
              </>
            ) : (
              "Confirm reject"
            )}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
