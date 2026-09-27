"use client";

// Patient portal home (PRD R2, R3): this month's cycle as a timeline, and one clear next action.
// The patient only ever sees statuses; never a reading, confidence or flag.
import { ChevronRightIcon, LogOutIcon, RefreshCwIcon } from "lucide-react";
import { m } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPatientCycle, getPatientTestLink, isTestPath, patientSignOut, requestRefill } from "@/lib/api/client";
import type { Cycle, CycleStatus } from "@/lib/api/contracts";
import { patientView, type PatientView } from "@/lib/cycle/copy";
import { cn } from "@/lib/utils";

import { CycleTimeline } from "./cycle-timeline";
import { PickupCountdown } from "./pickup-countdown";
import { EnrollForm } from "./signup-form";

export const PORTAL_REFRESH_MS = 15_000;
export const LOGIN_PATH = "/portal/login?next=%2Fportal";

/** A cycle in one of these states blocks a new request (the backend answers cycle_already_open). */
const OPEN: CycleStatus[] = ["requested", "approved", "submitted", "in_review", "window_open", "rejected"];

export const REQUEST_BLOCKED_NOTE = "You can request your next refill once this month's cycle is complete.";

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "not_enrolled" }
  | { kind: "error"; code: string }
  | { kind: "ready"; cycle: Cycle | null };

const EASE = [0.22, 1, 0.36, 1] as const;

export function PortalHome() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<"request" | "start" | "signout" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (mode: "initial" | "background") => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await getPatientCycle();
      if (result.ok) {
        setState({ kind: "ready", cycle: result.data.cycle });
        return;
      }
      const code = result.error.code;
      if (code === "unauthenticated") {
        setState({ kind: "signed_out" });
        return;
      }
      if (code === "not_enrolled") {
        setState({ kind: "not_enrolled" });
        return;
      }
      // A failed background refresh keeps what's on screen.
      setState((s) => (mode === "background" && s.kind === "ready" ? s : { kind: "error", code }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (state.kind === "signed_out") router.replace(LOGIN_PATH);
  }, [state.kind, router]);

  useEffect(() => {
    void load("initial");
    const refresh = () => {
      if (!document.hidden) void load("background");
    };
    const timer = setInterval(refresh, PORTAL_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  async function onRequest() {
    setBusy("request");
    setNotice(null);
    const result = await requestRefill();
    setBusy(null);
    if (result.ok) {
      await load("initial");
      return;
    }
    const code = result.error.code;
    if (code === "unauthenticated") return router.replace(LOGIN_PATH);
    if (code === "cycle_already_open") setNotice("You already have an open request for this month. It's shown below.");
    // not_enrolled needs no notice: the reload below shows the enrollment form.
    if (code !== "cycle_already_open" && code !== "not_enrolled") {
      setNotice("Could not send your request. Check your connection and try again.");
    }
    await load("initial");
  }

  async function onStartTest() {
    setBusy("start");
    setNotice(null);
    const result = await getPatientTestLink();
    if (result.ok && isTestPath(result.data.testPath)) {
      window.location.assign(result.data.testPath);
      return;
    }
    setBusy(null);
    if (!result.ok && result.error.code === "unauthenticated") return router.replace(LOGIN_PATH);
    setNotice(
      !result.ok && result.error.code === "no_test_link"
        ? "Your test link isn't ready yet. Check your email, or try again in a few minutes."
        : "Could not open your test. Check your connection and try again.",
    );
    await load("initial");
  }

  async function onSignOut() {
    setBusy("signout");
    await patientSignOut();
    router.replace("/portal/login");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-5 pb-10">
      <header className="flex items-center justify-between gap-3">
        <Wordmark size="sm" />
        <Button type="button" variant="outline" size="sm" onClick={onSignOut} disabled={busy === "signout"}>
          <LogOutIcon aria-hidden />
          Sign out
        </Button>
      </header>

      <main className="flex flex-1 flex-col pt-8">
        {state.kind === "loading" || state.kind === "signed_out" ? <PortalSkeleton /> : null}

        {state.kind === "error" ? (
          <div role="alert" className="space-y-4 rounded-2xl border border-stop/40 bg-stop/5 p-5">
            <h1 className="text-2xl font-semibold">
              {state.code === "not_available" ? "Your portal isn't available yet" : "Couldn't load your portal"}
            </h1>
            <p className="text-haze">
              {state.code === "not_available"
                ? "Your clinic hasn't switched on online refills yet. Contact your clinic for your monthly test."
                : "Check your connection and try again."}
            </p>
            <Button variant="outline" onClick={() => { setState({ kind: "loading" }); void load("initial"); }}>
              <RefreshCwIcon aria-hidden /> Try again
            </Button>
          </div>
        ) : null}

        {state.kind === "not_enrolled" ? (
          <section className="space-y-5">
            <h1 className="text-[2rem] leading-tight font-semibold">Link your account to your clinic</h1>
            <p className="text-lg leading-relaxed text-mist/90">
              Enter the enrollment code your clinic gave you. You only do this once.
            </p>
            <EnrollForm onEnrolled={() => void load("initial")} />
          </section>
        ) : null}

        {state.kind === "ready" ? (
          <CycleView
            cycle={state.cycle}
            busy={busy}
            notice={notice}
            onRequest={onRequest}
            onStartTest={onStartTest}
          />
        ) : null}
      </main>
    </div>
  );
}

function PortalSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading your portal</span>
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-14 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function CycleView({
  cycle,
  busy,
  notice,
  onRequest,
  onStartTest,
}: {
  cycle: Cycle | null;
  busy: "request" | "start" | "signout" | null;
  notice: string | null;
  onRequest: () => void;
  onStartTest: () => void;
}) {
  const view = patientView(cycle);
  const blocked = cycle !== null && (OPEN.includes(cycle.status) || (cycle.status === "declined" && !cycle.canRequestAgain));
  const reason = cycle?.status === "declined" ? cycle.declineReason : cycle?.status === "rejected" ? cycle.rejectReason : null;

  return (
    <m.section
      key={view.key}
      data-view={view.key}
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-orchid-text">This month</p>
        <h1 className="text-[2rem] leading-tight font-semibold">{view.title}</h1>
        <p className="text-lg leading-relaxed text-mist/90">{view.body}</p>
      </div>

      {reason ? (
        <blockquote className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-xs font-medium text-haze">From your clinic</p>
          <p className="mt-1 text-base text-mist">{reason}</p>
        </blockquote>
      ) : null}

      {cycle?.status === "window_open" && cycle.pickupDeadline ? <PickupCountdown deadline={cycle.pickupDeadline} /> : null}

      {notice ? (
        <p role="status" className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-mist">
          {notice}
        </p>
      ) : null}

      <PrimaryAction view={view} busy={busy} onRequest={onRequest} onStartTest={onStartTest} />

      {blocked && view.action !== "request_refill" && view.action !== "request_again" ? (
        <div className="space-y-1.5">
          <Button type="button" variant="outline" size="lg" disabled aria-describedby="request-blocked" className="h-12 w-full rounded-2xl">
            Request refill
          </Button>
          <p id="request-blocked" className="text-center text-sm text-haze">
            {REQUEST_BLOCKED_NOTE}
          </p>
        </div>
      ) : null}

      {cycle ? (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <CycleTimeline cycle={cycle} />
        </div>
      ) : null}
    </m.section>
  );
}

function PrimaryAction({
  view,
  busy,
  onRequest,
  onStartTest,
}: {
  view: PatientView;
  busy: "request" | "start" | "signout" | null;
  onRequest: () => void;
  onStartTest: () => void;
}) {
  if (!view.action) return null;
  const base = "tap-target h-14 w-full rounded-2xl text-lg";
  if (view.action === "start_test") {
    // The email is the main path; this button is the fallback, so it is not the brand color
    // unless the patient has no email to wait for.
    const primary = view.key === "approved_no_email" || view.key === "rejected";
    return (
      <Button
        type="button"
        size="lg"
        variant={primary ? "brand" : "outline"}
        className={cn(base, !primary && "border-orchid/50")}
        onClick={onStartTest}
        disabled={busy !== null}
      >
        {busy === "start" ? "Opening your test…" : "Start your test"}
        <ChevronRightIcon className="size-5" aria-hidden />
      </Button>
    );
  }
  return (
    <Button type="button" size="lg" variant="brand" className={base} onClick={onRequest} disabled={busy !== null}>
      {busy === "request" ? "Sending your request…" : view.action === "request_again" ? "Request again" : "Request refill"}
    </Button>
  );
}
