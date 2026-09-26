"use client";

import { CheckCircle2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/clinic/format";
import type { QueueCard as QueueCardData, QueueResponse } from "@/lib/clinic/queue";

import { QueueCard } from "./queue-card";
import type { ReviewOutcome } from "./review-actions";

export const REFRESH_INTERVAL_MS = 20_000;
export const COLLAPSE_MS = 2_500;
// Signed photo URLs last 5 minutes and change on every fetch. Reuse a card's URL for up
// to 4 minutes so refreshes don't reload the photo (or an open zoom dialog) every 20s.
export const PHOTO_URL_REUSE_MS = 4 * 60 * 1000;

type PhotoUrlCache = Map<string, { url: string; fetchedAt: number }>;

export function stabilizePhotoUrls(cards: QueueCardData[], cache: PhotoUrlCache, now: number): QueueCardData[] {
  const next: PhotoUrlCache = new Map();
  const result = cards.map((card) => {
    if (!card.photoUrl) return card;
    const previous = cache.get(card.submissionId);
    if (previous && now - previous.fetchedAt < PHOTO_URL_REUSE_MS) {
      next.set(card.submissionId, previous);
      return { ...card, photoUrl: previous.url };
    }
    next.set(card.submissionId, { url: card.photoUrl, fetchedAt: now });
    return card;
  });
  cache.clear();
  for (const [id, entry] of next) cache.set(id, entry);
  return result;
}

const FOLLOW_UP_STEP: Record<string, string> = {
  audit_failed: "the audit log entry",
  photo_delete_failed: "photo cleanup",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; status: number }
  | { kind: "ready"; cards: QueueCardData[]; refreshFailed: boolean };

type Resolution =
  | { kind: "done"; text: string }
  | { kind: "recorded_with_error"; text: string };

export function resolutionFor(outcome: ReviewOutcome): Resolution | null {
  if (outcome.ok) {
    return {
      kind: "done",
      text:
        outcome.status === "approved"
          ? `Approved${outcome.window ? ` · window closes ${formatDateTime(outcome.window.closesAt)}` : ""}`
          : "Rejected",
    };
  }
  if (outcome.reviewRecorded) {
    const step = FOLLOW_UP_STEP[outcome.error] ?? "a follow-up step";
    return { kind: "recorded_with_error", text: `Decision saved, but ${step} failed — tell the team.` };
  }
  return null;
}

export function QueueBoard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [resolved, setResolved] = useState<Record<string, Resolution>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(false);
  const photoUrls = useRef<PhotoUrlCache>(new Map());

  const load = useCallback(async (mode: "initial" | "background") => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      if (!res.ok) {
        setState((s) =>
          mode === "background" && s.kind === "ready" && res.status >= 500
            ? { ...s, refreshFailed: true }
            : { kind: "error", status: res.status },
        );
        return;
      }
      const body = (await res.json()) as QueueResponse;
      setState({
        kind: "ready",
        cards: stabilizePhotoUrls(body.cards, photoUrls.current, Date.now()),
        refreshFailed: false,
      });
    } catch {
      setState((s) => (mode === "background" && s.kind === "ready" ? { ...s, refreshFailed: true } : { kind: "error", status: 0 }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load("initial");
    const refresh = () => void load("background");
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  function dismiss(id: string) {
    setDismissed((d) => new Set(d).add(id));
  }

  function handleResolved(id: string, outcome: ReviewOutcome) {
    const resolution = resolutionFor(outcome);
    if (!resolution) return;
    setResolved((r) => ({ ...r, [id]: resolution }));
    if (resolution.kind === "done") setTimeout(() => dismiss(id), COLLAPSE_MS);
  }

  if (state.kind === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading tests waiting for review</span>
        {[0, 1, 2].map((i) => (
          <Card key={i} data-testid="queue-skeleton">
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Skeleton className="aspect-[4/3] w-full" />
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-10 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (state.kind === "error") {
    if (state.status === 401) {
      return (
        <Alert>
          <AlertTitle>Sign in required</AlertTitle>
          <AlertDescription>
            Sign in to see the review queue. <Link className="underline" href="/login">Go to sign in</Link>
          </AlertDescription>
        </Alert>
      );
    }
    if (state.status === 403) {
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
        <AlertTitle>Could not load the queue</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Check your connection and try again.</p>
          <Button
            variant="outline"
            onClick={() => {
              setState({ kind: "loading" });
              void load("initial");
            }}
          >
            <RefreshCwIcon aria-hidden /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Keep resolved cards visible (collapsed) until dismissed, even if a refetch drops them.
  const visible = [
    ...state.cards,
    ...Object.keys(resolved)
      .filter((id) => !state.cards.some((c) => c.submissionId === id))
      .map((id) => ({ submissionId: id }) as QueueCardData),
  ].filter((c) => !dismissed.has(c.submissionId));

  return (
    <div className="space-y-4">
      {state.refreshFailed ? (
        <p role="status" className="text-sm text-muted-foreground">
          Couldn&apos;t refresh just now; showing the last loaded list.
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No tests waiting for review</p>
      ) : (
        <ol className="space-y-6" aria-label="Tests waiting for review">
          {visible.map((card) => {
            const resolution = resolved[card.submissionId];
            return (
              <li key={card.submissionId}>
                {resolution ? (
                  <ResolvedCard resolution={resolution} onDismiss={() => dismiss(card.submissionId)} />
                ) : (
                  <QueueCard card={card} onResolved={(outcome) => handleResolved(card.submissionId, outcome)} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ResolvedCard({ resolution, onDismiss }: { resolution: Resolution; onDismiss: () => void }) {
  if (resolution.kind === "done") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm font-medium">
        <CheckCircle2Icon className="size-4" aria-hidden />
        {resolution.text}
      </div>
    );
  }
  return (
    <Alert variant="destructive" role="alert">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{resolution.text}</AlertTitle>
      <AlertDescription>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  );
}
