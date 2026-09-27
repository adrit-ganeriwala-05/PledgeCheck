"use client";

import { CheckCircle2Icon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { AnimatePresence, domMax, LazyMotion, m } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/clinic/format";
import { getQueue } from "@/lib/api/client";
import type { QueueCard as QueueCardData } from "@/lib/clinic/queue";

import { QueueCard } from "./queue-card";
import type { ReviewOutcome } from "./review-actions";
import { sortByUrgency } from "./sort";

// Polled, not pushed: Supabase Realtime would need the submissions table added to the realtime
// publication (a migration). A short interval with the in-flight guard keeps the split-screen demo
// live; polling pauses while the tab is hidden and resumes (with an immediate fetch) when it returns.
export const REFRESH_INTERVAL_MS = 3_000;
/** How long a newly arrived card keeps its highlight. */
export const NEW_HIGHLIGHT_MS = 8_000;
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
          ? `Test approved${outcome.window ? ` · window closes ${formatDateTime(outcome.window.closesAt)}` : ""}`
          : "Test rejected",
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
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const inFlight = useRef(false);
  const photoUrls = useRef<PhotoUrlCache>(new Map());
  // Ids seen so far; null until the first successful load, so the initial list is not "new".
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async (mode: "initial" | "background") => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await getQueue();
      if (!result.ok) {
        const { code, status } = result.error;
        setState((s) =>
          mode === "background" && s.kind === "ready" && (code === "network_error" || status >= 500)
            ? { ...s, refreshFailed: true }
            : { kind: "error", status },
        );
        return;
      }
      const body = result.data;
      const arrived = seen.current ? body.cards.filter((c) => !seen.current!.has(c.submissionId)).map((c) => c.submissionId) : [];
      seen.current = new Set([...(seen.current ?? []), ...body.cards.map((c) => c.submissionId)]);
      if (arrived.length > 0) {
        setFresh((f) => new Set([...f, ...arrived]));
        setAnnouncement(arrived.length === 1 ? "1 new test waiting for review" : `${arrived.length} new tests waiting for review`);
        setTimeout(() => {
          setFresh((f) => {
            const next = new Set(f);
            for (const id of arrived) next.delete(id);
            return next;
          });
        }, NEW_HIGHLIGHT_MS);
      }
      setState({
        kind: "ready",
        cards: stabilizePhotoUrls(body.cards, photoUrls.current, Date.now()),
        refreshFailed: false,
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load("initial");
    const refresh = () => void load("background");
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // J / K move between cards, anywhere on the page except while typing.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-queue-card][tabindex]"));
      if (cards.length === 0) return;
      e.preventDefault();
      const current = cards.findIndex((c) => c === document.activeElement || c.contains(document.activeElement));
      const next = current === -1 ? 0 : Math.min(cards.length - 1, Math.max(0, current + (key === "j" ? 1 : -1)));
      cards[next].focus();
      cards[next].scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
          <div key={i} data-testid="queue-skeleton" className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            <Skeleton className="h-6 w-40" />
            <div className="grid gap-4 md:grid-cols-[5fr_7fr]">
              <Skeleton className="aspect-4/3 w-full" />
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-7 w-2/3" />
              </div>
            </div>
            <Skeleton className="h-11 w-full" />
          </div>
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
    ...sortByUrgency(state.cards),
    ...Object.keys(resolved)
      .filter((id) => !state.cards.some((c) => c.submissionId === id))
      .map((id) => ({ submissionId: id }) as QueueCardData),
  ].filter((c) => !dismissed.has(c.submissionId));
  const waiting = visible.filter((c) => !resolved[c.submissionId]).length;

  return (
    <LazyMotion features={domMax} strict>
      <div className="space-y-4">
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-mist">
            <span className="tabular font-semibold">{waiting}</span>{" "}
            <span className="text-haze">{waiting === 1 ? "test waiting" : "tests waiting"}</span>
          </p>
          <div className="flex items-center gap-4 text-haze">
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <Key>J</Key>
              <Key>K</Key> move between cards
            </span>
            {state.refreshFailed ? (
              <span role="status" className="text-warn">
                Couldn&apos;t refresh just now; showing the last loaded list.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="relative flex size-2" aria-hidden>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok/60 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2 rounded-full bg-ok" />
                </span>
                Live
              </span>
            )}
          </div>
        </div>
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
            <p className="font-display text-xl font-semibold text-mist">No tests waiting for review</p>
            <p className="mt-2 text-sm text-haze">
              Approve a refill in <Link className="text-orchid-text underline" href="/requests">Requests</Link> or issue a
              link from <Link className="text-orchid-text underline" href="/patients">Patients</Link>. When the patient
              sends their photo, the test appears here within seconds.
            </p>
          </div>
        ) : (
          <ol className="space-y-5" aria-label="Tests waiting for review">
            <AnimatePresence initial={false}>
              {visible.map((card) => {
                const resolution = resolved[card.submissionId];
                return (
                  <m.li
                    key={card.submissionId}
                    layout="position"
                    initial={{ opacity: 0, y: -16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 48, transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}
                    transition={{ type: "spring", stiffness: 260, damping: 32, mass: 1 }}
                  >
                    {resolution ? (
                      <ResolvedCard resolution={resolution} onDismiss={() => dismiss(card.submissionId)} />
                    ) : (
                      <QueueCard
                        card={card}
                        isNew={fresh.has(card.submissionId)}
                        onResolved={(outcome) => handleResolved(card.submissionId, outcome)}
                      />
                    )}
                  </m.li>
                );
              })}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </LazyMotion>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid size-5 place-items-center rounded border border-line text-[0.7rem] font-semibold text-haze">
      {children}
    </kbd>
  );
}

function ResolvedCard({ resolution, onDismiss }: { resolution: Resolution; onDismiss: () => void }) {
  if (resolution.kind === "done") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-2xl border border-ok/30 bg-ok/5 px-4 py-3 text-sm font-medium text-mist">
        <CheckCircle2Icon className="size-4 text-ok" aria-hidden />
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
