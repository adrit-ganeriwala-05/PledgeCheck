"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { formatDateTime } from "@/lib/clinic/format";
import type { QueueCard as QueueCardData, QueueResponse } from "@/lib/clinic/queue";

import { QueueCard } from "./queue-card";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; status: number }
  | { kind: "ready"; cards: QueueCardData[] };

export function QueueBoard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/queue", { cache: "no-store" });
      if (!res.ok) return setState({ kind: "error", status: res.status });
      const body = (await res.json()) as QueueResponse;
      setState({ kind: "ready", cards: body.cards });
    } catch {
      setState({ kind: "error", status: 0 });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  if (state.kind === "loading") return <p className="text-muted-foreground">Loading tests…</p>;
  if (state.kind === "error") {
    if (state.status === 401) {
      return (
        <p>
          Sign in to see the review queue. <Link className="underline" href="/login">Go to sign in</Link>
        </p>
      );
    }
    if (state.status === 403) return <p>This account is not a clinician at a practice.</p>;
    return <p role="alert">Could not load the queue.</p>;
  }
  if (state.cards.length === 0) return <p className="text-muted-foreground">No tests waiting for review</p>;

  return (
    <ol className="space-y-6" aria-label="Tests waiting for review">
      {state.cards.map((card) => (
        <li key={card.submissionId}>
          <QueueCard
            card={card}
            onReviewed={(outcome) => {
              toast.success(
                outcome.status === "approved"
                  ? `Approved ${card.patient.pseudonym}${outcome.window ? ` · window closes ${formatDateTime(outcome.window.closesAt)}` : ""}`
                  : `Rejected ${card.patient.pseudonym}`,
              );
              setState((s) =>
                s.kind === "ready" ? { ...s, cards: s.cards.filter((c) => c.submissionId !== card.submissionId) } : s,
              );
            }}
          />
        </li>
      ))}
    </ol>
  );
}
