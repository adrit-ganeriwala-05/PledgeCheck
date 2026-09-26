"use client";

// The patient capture flow. Owner: Labib (ticket L1).
//
// Live camera only: there is no file input anywhere on this page, and the
// photo is read straight off a MediaStream frame. That is fraud check 2.
// It needs HTTPS, so test it on a Vercel preview, never on localhost.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clipPath,
  stepText,
  UI_TEXT,
  type CaptureStep,
  type Language,
} from "@/lib/voice";

/** Longest edge of the photo we send. Keeps the upload near 1 MB. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

type Phase = "intro" | "code" | "camera" | "review" | "sending" | "sent" | "failed";

const PHASE_STEP: Partial<Record<Phase, CaptureStep>> = {
  intro: "welcome",
  code: "write_code",
  camera: "frame",
  review: "review",
  sent: "sent",
};

export function CaptureFlow({
  token,
  challengeCode,
  language,
}: {
  token: string;
  challengeCode: string;
  language: Language;
}) {
  const t = UI_TEXT[language];
  const [phase, setPhase] = useState<Phase>("intro");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // A dead link cannot be retried; only a transient failure can.
  const [terminal, setTerminal] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // One clip per step. Autoplay is blocked until the patient taps, which is
  // why the first tap is a plain "Start" button.
  useEffect(() => {
    const step = PHASE_STEP[phase];
    const audio = audioRef.current;
    if (!step || !audio || phase === "intro") return;

    audio.src = clipPath(language, step);
    audio.play().catch(() => {
      // No clip generated yet, or the browser refused. The text is on screen.
    });
  }, [phase, language]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
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

    const body = new FormData();
    body.append("token", token);
    body.append("image", photo.blob, "test.jpg");

    try {
      const response = await fetch("/api/submissions", { method: "POST", body });
      const data = (await response.json()) as { received?: boolean; reason?: string };

      if (!response.ok || data.received === false) {
        setFailure(patientMessage(data.reason, language));
        setTerminal(TERMINAL_REASONS.includes(data.reason ?? ""));
        setPhase("failed");
        return;
      }
      setPhase("sent");
    } catch {
      setFailure(
        language === "es"
          ? "No se pudo enviar. Revise su conexión."
          : "Could not send. Check your connection.",
      );
      setTerminal(false);
      setPhase("failed");
    }
  }, [photo, token, language]);

  return (
    <div className="flex min-h-dvh flex-col gap-5 px-5 py-6">
      <audio ref={audioRef} preload="none" className="hidden" />

      <header className="flex items-baseline justify-between">
        <p className="text-sm font-semibold tracking-widest text-[var(--pc-brand)] uppercase">
          PledgeCheck
        </p>
        <p className="text-sm text-[var(--pc-muted)]">{t.title}</p>
      </header>

      {phase !== "sent" && phase !== "failed" && (
        <p className="text-lg leading-relaxed">{stepText(language, PHASE_STEP[phase] ?? "welcome")}</p>
      )}

      {(phase === "code" || phase === "camera" || phase === "review") && (
        <div className="rounded-xl border border-[var(--pc-line)] bg-white p-4 text-center">
          <p className="text-sm text-[var(--pc-muted)]">{t.codeLabel}</p>
          <p className="mt-1 font-mono text-5xl font-bold tracking-[0.3em]">{challengeCode}</p>
        </div>
      )}

      {phase === "camera" && (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full flex-1 rounded-xl bg-black object-cover"
        />
      )}

      {phase === "review" && photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="" className="w-full flex-1 rounded-xl object-contain" />
      )}

      {phase === "sent" && (
        <div className="flex flex-1 flex-col justify-center gap-3 text-center">
          <p className="text-5xl" aria-hidden>
            ✓
          </p>
          <h1 className="text-2xl font-semibold">{t.sentTitle}</h1>
          <p className="text-[var(--pc-muted)]">{stepText(language, "sent")}</p>
        </div>
      )}

      {phase === "failed" && (
        <div className="flex flex-1 flex-col justify-center gap-4 text-center">
          <h1 className="text-2xl font-semibold text-[var(--pc-stop)]">{t.linkProblem}</h1>
          <p className="text-[var(--pc-muted)]">{failure}</p>
        </div>
      )}

      {cameraError && (
        <p className="rounded-lg bg-red-50 p-4 text-[var(--pc-stop)]">{cameraError}</p>
      )}

      <div className="sticky bottom-0 flex flex-col gap-3 bg-[#f8fafc] pt-2 pb-2">
        {phase === "intro" && (
          <Button onClick={() => setPhase("code")}>{t.start}</Button>
        )}
        {phase === "code" && <Button onClick={startCamera}>{t.openCamera}</Button>}
        {phase === "camera" && <Button onClick={takePhoto}>{t.takePhoto}</Button>}
        {phase === "review" && (
          <>
            <Button onClick={send}>{t.send}</Button>
            <Button onClick={retake} variant="secondary">
              {t.retake}
            </Button>
          </>
        )}
        {phase === "sending" && (
          <Button disabled onClick={() => {}}>
            {t.sending}
          </Button>
        )}
        {phase === "failed" && !terminal && (
          <Button onClick={send} variant="secondary">
            {t.tryAgain}
          </Button>
        )}
      </div>
    </div>
  );
}

function Button({
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
    "tap-target w-full rounded-xl px-6 text-lg font-semibold transition disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-[var(--pc-brand)] text-white hover:bg-[var(--pc-brand-dark)]"
      : "border border-[var(--pc-line)] bg-white hover:bg-slate-50";

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

/** Failures a new photo cannot fix: the link itself is spent. */
const TERMINAL_REASONS = ["expired", "already_used", "not_found"];

/** Never tell the patient what the test read; only what to do next. */
function patientMessage(reason: string | undefined, language: Language): string {
  const en: Record<string, string> = {
    expired: "This link has expired. Ask your clinic for a new one.",
    already_used: "This link was already used. Ask your clinic for a new one.",
    not_found: "This link is not valid. Ask your clinic for a new one.",
  };
  const es: Record<string, string> = {
    expired: "Este enlace ha caducado. Pida uno nuevo a su clínica.",
    already_used: "Este enlace ya fue usado. Pida uno nuevo a su clínica.",
    not_found: "Este enlace no es válido. Pida uno nuevo a su clínica.",
  };

  const table = language === "es" ? es : en;
  return (
    table[reason ?? ""] ??
    (language === "es"
      ? "No pudimos aceptar esta foto. Contacte a su clínica."
      : "We could not accept this photo. Contact your clinic.")
  );
}
