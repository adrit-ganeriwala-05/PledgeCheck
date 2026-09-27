"use client";

// The patient capture flow. Owner: Labib (ticket L1). Redesign: calm, one step per screen.
//
// Live camera only: there is no file input anywhere on this page, and the
// photo is read straight off a MediaStream frame. That is fraud check 2.
// It needs HTTPS, so test it on a Vercel preview, never on localhost.
//
// The challenge code is not on the page until the patient taps Start: that calls
// POST /api/t/:token/start, which begins the session (SESSION_MINUTES) and returns the
// code and deadline. Reopening the link mid-session calls it again and gets the same
// code back. A countdown shows the time left; at zero the session is over. When the start
// response also carries codeExpiresAt (PRD R13), the countdown runs to whichever is sooner.
//
// v3 (PRD R7): the link only works for the signed-in patient it was issued to. A signed-out
// patient signs in right here (the link never travels through a login URL), and a different
// account gets its own screen with a sign-out button.
//
// 3D: the test model appears only on the Welcome and "how to photograph" steps, before Start,
// so it never shows the code. It is unmounted when the patient moves on, and the camera waits
// until its WebGL context is released (the camera needs the GPU).

import { CheckIcon, ChevronRightIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { m } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { PatientSignInForm } from "@/components/portal/patient-sign-in-form";
import { testModelsReleased } from "@/components/test-model/release";
import { TestModel } from "@/components/test-model/test-model";
import { patientSignOut, startTestSession, submitTestPhoto } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  clipPath,
  LINK_PROBLEM_TEXT,
  stepText,
  UI_TEXT,
  type CaptureStep,
  type Language,
  type LinkProblemState,
} from "@/lib/voice";

import { PATIENT_COPY, STEP_COUNT } from "./copy";

/** Longest edge of the photo we send. Keeps the upload near 1 MB. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

type Phase = "intro" | "how" | "code" | "camera" | "review" | "sending" | "sent" | "failed" | "signin" | "wrong_patient";

const PHASE_STEP: Partial<Record<Phase, CaptureStep>> = {
  intro: "welcome",
  code: "write_code",
  camera: "frame",
  review: "review",
  sent: "sent",
};

/** Numbered steps; Welcome and the final screen are not numbered. */
const STEP_NUMBER: Partial<Record<Phase, number>> = { how: 1, code: 2, camera: 3, review: 4, sending: 4 };

/** "mm:ss", never negative. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const START_FAILURES: LinkProblemState[] = [
  "invalid",
  "link_expired",
  "session_expired",
  "submitted",
  "invalidated",
  "expired",
  "already_used",
];

/** Phases that end when the session runs out. */
const SESSION_PHASES: Phase[] = ["code", "camera", "review"];

const EASE = [0.22, 1, 0.36, 1] as const;

export function CaptureFlow({
  token,
  language: initialLanguage,
  resumed = false,
}: {
  token: string;
  language: Language;
  /** The session was already started (the patient reopened the link). */
  resumed?: boolean;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [voice, setVoice] = useState(true);
  const t = UI_TEXT[language];
  const c = PATIENT_COPY[language];
  const [phase, setPhase] = useState<Phase>("intro");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [openingCamera, setOpeningCamera] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A dead link cannot be retried; only a transient failure can.
  const [terminal, setTerminal] = useState(false);
  // What "Try again" repeats: starting the session, or sending the photo.
  const [failedStep, setFailedStep] = useState<"start" | "send">("send");
  // endsAt is the sooner of the session end and the code expiry; `expiry` says which.
  const [session, setSession] = useState<{ code: string; endsAt: number; expiry: "session" | "code" } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const playClip = useCallback(
    (step: CaptureStep, lang: Language) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = clipPath(lang, step);
      // Older browsers (and jsdom) return undefined instead of a promise.
      const played = audio.play() as Promise<void> | undefined;
      if (played) {
        played.catch(() => {
          // No clip generated yet, or the browser refused. The text is on screen.
        });
      }
    },
    [],
  );

  // One clip per step. Autoplay is blocked until the patient taps, so the welcome clip plays
  // only from a tap on the voice or language control; later steps follow a tap anyway.
  useEffect(() => {
    const step = PHASE_STEP[phase];
    if (!step || !voice || phase === "intro") return;
    playClip(step, language);
  }, [phase, language, voice, playClip]);

  function toggleVoice() {
    const next = !voice;
    setVoice(next);
    if (next && phase === "intro") playClip("welcome", language);
    if (!next) audioRef.current?.pause();
  }

  function chooseLanguage(next: Language) {
    setLanguage(next);
    if (voice && phase === "intro") playClip("welcome", next);
  }

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Countdown. The server enforces the deadline; this only tells the patient, and ends
  // the flow at zero unless the photo is already on its way.
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= session.endsAt && SESSION_PHASES.includes(phaseRef.current)) {
        clearInterval(timer);
        stopCamera();
        setFailure(LINK_PROBLEM_TEXT[language][session.expiry === "code" ? "code_expired" : "session_expired"]);
        setTerminal(true);
        setPhase("failed");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [session, language, stopCamera]);

  const startSession = useCallback(async () => {
    setStarting(true);
    setFailure(null);
    const result = await startTestSession(token);
    setStarting(false);
    if (result.ok) {
      const sessionEnd = Date.parse(result.data.sessionEndsAt);
      const codeEnd = result.data.codeExpiresAt ? Date.parse(result.data.codeExpiresAt) : Number.POSITIVE_INFINITY;
      setNow(Date.now());
      setSession({
        code: result.data.challengeCode,
        endsAt: Math.min(sessionEnd, codeEnd),
        expiry: codeEnd < sessionEnd ? "code" : "session",
      });
      setPhase("code");
      return;
    }
    const code = result.error.code;
    if (code === "not_logged_in") {
      setPhase("signin");
      return;
    }
    if (code === "wrong_patient") {
      setPhase("wrong_patient");
      return;
    }
    if (code === "network_error") {
      setFailure(t.startFailed);
      setTerminal(false);
    } else {
      const state = START_FAILURES.find((s) => s === code) ?? "error";
      setFailure(LINK_PROBLEM_TEXT[language][state]);
      setTerminal(state !== "error");
    }
    setFailedStep("start");
    setPhase("failed");
  }, [token, language, t.startFailed]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    await patientSignOut();
    setSigningOut(false);
    setPhase("signin");
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setOpeningCamera(true);
    try {
      // The 3D model was unmounted with the steps before Start; make sure its GPU context is gone.
      await testModelsReleased();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      setPhase("camera");
      // The <video> mounts with the phase change, so attach on the next frame.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCameraError(t.cameraBlocked);
      setPhase((p) => (p === "camera" ? "code" : p));
    } finally {
      setOpeningCamera(false);
    }
  }, [t.cameraBlocked]);

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return;

    stopCamera();
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    setPhase("review");
  }, [stopCamera]);

  const retake = useCallback(() => {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    void startCamera();
  }, [photo, startCamera]);

  const send = useCallback(async () => {
    if (!photo) return;
    setPhase("sending");
    setFailure(null);

    const result = await submitTestPhoto(token, photo.blob);
    if (result.ok) {
      setPhase("sent");
      return;
    }
    if (result.error.code === "network_error") {
      setFailure(
        language === "es"
          ? "No se pudo enviar. Revise su conexión."
          : "Could not send. Check your connection.",
      );
      setTerminal(false);
    } else {
      setFailure(patientMessage(result.error.code, language));
      setTerminal(isTerminalReason(result.error.code));
    }
    setFailedStep("send");
    setPhase("failed");
  }, [photo, token, language]);

  const step = STEP_NUMBER[phase];
  const timer = session ? (
    <p className="tabular text-sm text-haze" role="timer" aria-live="off">
      {t.timeLeft}: <span className="font-semibold text-mist">{formatRemaining(session.endsAt - now)}</span>
    </p>
  ) : null;

  if (phase === "camera" && session) {
    return (
      <>
        <audio ref={audioRef} preload="none" className="hidden" />
        <CameraView
          videoRef={videoRef}
          code={session.code}
          codeLabel={c.codeChip}
          hint={c.frameHint}
          script={stepText(language, "frame")}
          shutterLabel={c.shutter}
          stepLabel={c.stepOf(3)}
          timer={timer}
          onShutter={takePhoto}
        />
      </>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-5 pb-6">
      <audio ref={audioRef} preload="none" className="hidden" />

      <header className="flex items-center justify-between gap-3">
        <Wordmark size="sm" />
        {step ? <StepIndicator step={step} label={c.stepOf(step)} /> : <p className="text-sm text-haze">{t.title}</p>}
      </header>

      <m.main
        key={phase === "sending" ? "review" : phase}
        className="flex flex-1 flex-col pt-6"
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        {phase === "intro" && (
          <>
            {/* Language and voice come first: a patient may not read English. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <LanguageToggle label={c.languageLabel} value={language} onChange={chooseLanguage} />
              <button
                type="button"
                aria-pressed={voice}
                onClick={toggleVoice}
                className={cn(
                  "inline-flex h-12 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                  voice ? "border-orchid bg-orchid/15 text-mist" : "border-line text-haze",
                )}
              >
                {voice ? <Volume2Icon className="size-4" aria-hidden /> : <VolumeXIcon className="size-4" aria-hidden />}
                {c.voiceLabel}
              </button>
            </div>
            {/* Crop the empty stage above and below the test; the canvas keeps its own aspect. */}
            <div className="-mx-5 my-2 flex h-52 items-center overflow-hidden">
              <TestModel
                view="hero"
                maxTier="medium"
                autoRotate
                lineProgress={1}
                alt={c.modelAlt}
                priority
                sizes="(max-width: 448px) 100vw, 448px"
                className="w-full shrink-0"
              />
            </div>
            <h1 className="text-[2rem] leading-tight font-semibold">{c.welcomeTitle}</h1>
            <p className="mt-3 text-lg leading-relaxed text-mist/90">{c.welcomeBody}</p>
            <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-haze">
              <span>{c.duration}</span>
              <span>{c.privacy}</span>
            </p>
          </>
        )}

        {phase === "how" && (
          <>
            <h1 className="text-[1.75rem] leading-tight font-semibold">{c.howTitle}</h1>
            <div className="-mx-5 flex h-60 items-center overflow-hidden">
              <TestModel
                view="instruction"
                maxTier="medium"
                draggable
                showCode
                code={null}
                alt={c.instructionAlt}
                sizes="(max-width: 448px) 100vw, 448px"
                className="w-full shrink-0"
              />
            </div>
            <p className="mb-5 text-center text-sm text-haze">{c.dragHint}</p>
            <ol className="space-y-3">
              {c.howPoints.map((point, i) => (
                <li key={point} className="flex gap-3 text-base leading-relaxed">
                  <span className="tabular mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-line text-sm font-semibold text-orchid-text">
                    {i + 1}
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        {phase === "code" && session && (
          <>
            <h1 className="text-[1.75rem] leading-tight font-semibold">{c.codeTitle}</h1>
            <CodeReveal code={session.code} />
            <p className="mt-4 text-base leading-relaxed text-mist/90">{c.codeHint}</p>
            <div className="mt-3">{timer}</div>
            {cameraError ? (
              <CameraHelp title={c.cameraTitle} lead={cameraError} steps={c.cameraSteps} />
            ) : null}
          </>
        )}

        {(phase === "review" || phase === "sending") && photo && (
          <>
            <h1 className="text-[1.75rem] leading-tight font-semibold">{c.reviewTitle}</h1>
            <p className="mt-2 text-base leading-relaxed text-haze">{stepText(language, "review")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
            <img src={photo.url} alt="" className="mt-4 max-h-[46dvh] w-full rounded-2xl bg-black object-contain" />
            <ul className="mt-4 space-y-2">
              {c.reviewChecks.map((check) => (
                <li key={check} className="flex items-center gap-2 text-base">
                  <CheckIcon className="size-4 shrink-0 text-orchid" aria-hidden />
                  {check}
                </li>
              ))}
            </ul>
            <div className="mt-3">{timer}</div>
          </>
        )}

        {phase === "sent" && <Sent title={t.sentTitle} body={c.sentBody} />}

        {phase === "signin" && (
          <div className="flex flex-1 flex-col gap-5">
            <div className="space-y-2">
              <h1 className="text-[1.75rem] leading-tight font-semibold">{c.signInTitle}</h1>
              <p className="text-base leading-relaxed text-mist/90">{c.signInBody}</p>
            </div>
            <PatientSignInForm copy={c.form} showSignUpLink={false} onSignedIn={() => void startSession()} />
          </div>
        )}

        {phase === "wrong_patient" && (
          <div className="flex flex-1 flex-col justify-center gap-4 text-center">
            <h1 className="text-2xl font-semibold">{c.wrongPatientTitle}</h1>
            <p className="text-haze">{c.wrongPatientBody}</p>
          </div>
        )}

        {phase === "failed" && (
          <div className="flex flex-1 flex-col justify-center gap-4 text-center">
            <h1 className="text-2xl font-semibold">
              {terminal ? t.linkProblem : failedStep === "send" ? c.notSentTitle : c.startProblemTitle}
            </h1>
            <p className="text-haze">{failure}</p>
            {failedStep === "send" && !terminal && photo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img src={photo.url} alt="" className="mx-auto max-h-48 rounded-xl bg-black object-contain" />
                <p className="text-sm text-haze">{c.photoKept}</p>
              </>
            ) : null}
            {terminal ? (
              <a href="/portal" className="font-medium text-orchid-text underline">
                {c.goToPortal}
              </a>
            ) : null}
          </div>
        )}
      </m.main>

      <div className="sticky bottom-0 -mx-5 mt-6 flex flex-col gap-3 bg-linear-to-t from-ink via-ink to-ink/0 px-5 pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {phase === "intro" &&
          (resumed ? (
            <PatientButton onClick={startSession} disabled={starting}>
              {starting ? t.starting : t.resume}
            </PatientButton>
          ) : (
            <PatientButton onClick={() => setPhase("how")}>
              {c.next}
              <ChevronRightIcon className="size-5" aria-hidden />
            </PatientButton>
          ))}
        {phase === "how" && (
          <PatientButton onClick={startSession} disabled={starting}>
            {starting ? t.starting : t.start}
          </PatientButton>
        )}
        {phase === "code" && (
          <PatientButton onClick={startCamera} disabled={openingCamera}>
            {openingCamera ? c.openingCamera : cameraError ? c.cameraRetry : t.openCamera}
          </PatientButton>
        )}
        {phase === "review" && (
          <>
            <PatientButton onClick={send}>{t.send}</PatientButton>
            <PatientButton onClick={retake} variant="secondary">
              {t.retake}
            </PatientButton>
          </>
        )}
        {phase === "sending" && (
          <PatientButton disabled onClick={() => {}}>
            {t.sending}
          </PatientButton>
        )}
        {phase === "failed" && !terminal && (
          <PatientButton onClick={failedStep === "start" ? startSession : send}>{t.tryAgain}</PatientButton>
        )}
        {phase === "wrong_patient" && (
          <PatientButton onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? c.signingOut : c.signOut}
          </PatientButton>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step, label }: { step: number; label: string }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="text-sm font-medium text-haze">{label}</p>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <span key={i} className={cn("h-1 w-6 rounded-full", i < step ? "bg-orchid" : "bg-line")} />
        ))}
      </div>
    </div>
  );
}

function LanguageToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Language;
  onChange: (language: Language) => void;
}) {
  const options: { value: Language; label: string }[] = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
  ];
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            lang={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-10 min-w-20 rounded-full px-3 text-sm font-semibold transition-colors",
              value === option.value ? "bg-mist text-ink" : "text-haze hover:text-mist",
            )}
          >
            {option.label}
          </button>
        ))}
    </div>
  );
}

// The one orchestrated moment of the flow: the characters settle into place one after another.
function CodeReveal({ code }: { code: string }) {
  return (
    <div className="mt-5 rounded-3xl border border-line bg-surface px-4 py-7 text-center">
      <p
        className="tabular flex justify-center gap-[0.14em] text-[clamp(3.5rem,19vw,4.75rem)] leading-none font-bold text-mist"
        data-testid="challenge-code"
        aria-label={code.split("").join(" ")}
      >
        {code.split("").map((ch, i) => (
          <m.span
            key={`${ch}-${i}`}
            aria-hidden
            className="inline-block"
            initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.15 + i * 0.14, duration: 0.7, ease: EASE }}
          >
            {ch}
          </m.span>
        ))}
      </p>
      <m.div
        aria-hidden
        className="mx-auto mt-5 h-0.5 w-24 rounded-full bg-brand-gradient"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.15 + code.length * 0.14, duration: 0.6, ease: EASE }}
      />
    </div>
  );
}

function CameraHelp({ title, lead, steps }: { title: string; lead: string; steps: string[] }) {
  return (
    <div role="alert" className="mt-5 rounded-2xl border border-warn/40 bg-warn/5 p-4">
      <p className="font-semibold text-mist">{title}</p>
      <p className="mt-1 text-sm text-haze">{lead}</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-mist">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function CameraView({
  videoRef,
  code,
  codeLabel,
  hint,
  script,
  shutterLabel,
  stepLabel,
  timer,
  onShutter,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  code: string;
  codeLabel: string;
  hint: string;
  /** The voice clip's text, always on screen as its fallback. */
  script: string;
  shutterLabel: string;
  stepLabel: string;
  timer: React.ReactNode;
  onShutter: () => void;
}) {
  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-black">
      <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
      <FrameGuide code={code} />
      {/* Top: the code stays pinned while the patient frames the photo. */}
      <div className="relative flex items-start justify-between gap-3 bg-linear-to-b from-black/80 to-black/0 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8">
        <div className="rounded-2xl bg-black/60 px-3 py-2 backdrop-blur-md">
          <p className="text-xs text-haze">{codeLabel}</p>
          <p className="tabular text-3xl leading-none font-bold tracking-[0.12em] text-mist">{code}</p>
        </div>
        <div className="flex flex-col items-end gap-1 rounded-2xl bg-black/60 px-3 py-2 backdrop-blur-md">
          <p className="text-xs text-haze">{stepLabel}</p>
          {timer}
        </div>
      </div>
      <div className="relative mt-auto flex flex-col items-center gap-4 bg-linear-to-t from-black/85 to-black/0 px-4 pt-10 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="max-w-sm rounded-2xl bg-black/60 px-4 py-2.5 text-center backdrop-blur-md">
          <p className="text-base font-semibold text-mist">{hint}</p>
          <p className="mt-1 text-sm text-mist/80">{script}</p>
        </div>
        <button
          type="button"
          onClick={onShutter}
          aria-label={shutterLabel}
          className="group grid size-20 place-items-center rounded-full border-4 border-mist/90 transition-transform active:scale-95"
        >
          <span className="size-15 rounded-full bg-rose transition-transform group-active:scale-90" />
        </button>
      </div>
    </div>
  );
}

// Outline for the test (horizontal, as it lies flat) and a marked spot where the code is written.
function FrameGuide({ code }: { code: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-x-4 top-1/2 h-[40%] w-[calc(100%-2rem)] -translate-y-1/2"
    >
      <rect x="3" y="36" width="94" height="28" rx="12" fill="none" stroke="rgba(243,233,255,0.9)" strokeWidth="0.8" strokeDasharray="3 2" />
      {/* Result window. */}
      <rect x="30" y="45" width="22" height="10" rx="2.5" fill="none" stroke="rgba(243,233,255,0.75)" strokeWidth="0.6" />
      {/* Where the code goes. */}
      <rect x="57" y="42" width="20" height="16" rx="2.5" fill="rgba(178,102,255,0.14)" stroke="#B266FF" strokeWidth="0.8" />
      <text x="67" y="51.6" textAnchor="middle" fontSize="4" fill="#F3E9FF" fontFamily="sans-serif">
        {code}
      </text>
    </svg>
  );
}

// Success in rose and orchid: a ring draws itself, then the check. CSS/SVG only, no three.js.
function Sent({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="relative grid size-40 place-items-center">
        <m.div
          aria-hidden
          className="absolute inset-0 rounded-full bg-brand-gradient opacity-25 blur-2xl"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.35 }}
          transition={{ duration: 1.2, ease: EASE }}
        />
        <svg viewBox="0 0 120 120" className="relative size-36" aria-hidden>
          <defs>
            <linearGradient id="sent-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#FF4FA8" />
              <stop offset="1" stopColor="#B266FF" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="50" fill="none" stroke="#2E2140" strokeWidth="6" />
          <m.circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="url(#sent-ring)"
            strokeWidth="6"
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: EASE }}
          />
          <m.path
            d="M40 62 L54 76 L82 46"
            fill="none"
            stroke="#F3E9FF"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.55, ease: EASE }}
          />
        </svg>
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-lg leading-relaxed text-haze">{body}</p>
      </div>
    </div>
  );
}

function PatientButton({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const base =
    "tap-target inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 text-lg font-semibold transition disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-rose text-black hover:brightness-110 active:brightness-95"
      : "border border-line bg-transparent text-mist hover:bg-surface";

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(base, styles)}>
      {children}
    </button>
  );
}

/** Failures a new photo cannot fix: the link itself is spent. */
const TERMINAL_REASONS = [
  "expired",
  "already_used",
  "not_found",
  "invalid_link",
  "session_not_started",
  "session_expired",
  "already_submitted",
];

export function isTerminalReason(reason: string | undefined): boolean {
  return TERMINAL_REASONS.includes(reason ?? "");
}

/** Never tell the patient what the test read; only what to do next. */
export function patientMessage(reason: string | undefined, language: Language): string {
  const en: Record<string, string> = {
    expired: "This link has expired. Ask your clinic for a new one.",
    already_used: "This link was already used. Ask your clinic for a new one.",
    not_found: "This link is not valid. Ask your clinic for a new one.",
    invalid_link: LINK_PROBLEM_TEXT.en.invalid,
    session_not_started: "This test session was not started. Open the link again and tap Start.",
    session_expired: LINK_PROBLEM_TEXT.en.session_expired,
    already_submitted: LINK_PROBLEM_TEXT.en.submitted,
  };
  const es: Record<string, string> = {
    expired: "Este enlace ha caducado. Pida uno nuevo a su clínica.",
    already_used: "Este enlace ya fue usado. Pida uno nuevo a su clínica.",
    not_found: "Este enlace no es válido. Pida uno nuevo a su clínica.",
    invalid_link: LINK_PROBLEM_TEXT.es.invalid,
    session_not_started: "Esta sesión de prueba no se inició. Abra el enlace otra vez y toque Comenzar.",
    session_expired: LINK_PROBLEM_TEXT.es.session_expired,
    already_submitted: LINK_PROBLEM_TEXT.es.submitted,
  };

  const table = language === "es" ? es : en;
  return (
    table[reason ?? ""] ??
    (language === "es"
      ? "No pudimos aceptar esta foto. Contacte a su clínica."
      : "We could not accept this photo. Contact your clinic.")
  );
}
