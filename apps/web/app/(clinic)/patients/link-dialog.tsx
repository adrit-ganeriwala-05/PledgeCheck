"use client";

import { m } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const ONCE_WARNING = "This link is shown once. Anyone with it can start this patient's test session.";

export type IssuedLink = { link: string; expiresAt: string; setting: "home" | "clinic" };

export function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function LinkDialog({
  issued,
  pseudonym,
  onClose,
}: {
  issued: IssuedLink | null;
  pseudonym: string;
  onClose: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (!issued) return;
    let cancelled = false;
    QRCode.toString(issued.link, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#F3E9FF" },
    })
      .then((svg) => {
        if (!cancelled) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
      setQr(null);
      setQrFailed(false);
      setCopy("idle");
    };
  }, [issued]);

  async function copyLink() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.link);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <Dialog open={issued !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-line bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{issued?.setting === "clinic" ? "Clinic" : "Home"} test link for {pseudonym}</DialogTitle>
          <DialogDescription>Send this link to the patient, or let them scan the code.</DialogDescription>
        </DialogHeader>
        {issued && (
          <div className="flex flex-col gap-4">
            <Alert role="note" className="border-warn/40 bg-warn/10 text-mist">
              <AlertDescription className="text-mist">{ONCE_WARNING}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label="Test link"
                value={issued.link}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-ink px-2.5 text-xs text-mist"
              />
              <Button type="button" onClick={copyLink}>
                {copy === "copied" ? "Copied" : "Copy"}
              </Button>
            </div>
            {copy === "failed" && (
              <p className="text-sm text-stop">Could not copy. Select the link and copy it manually.</p>
            )}
            <div className="flex min-h-[232px] items-center justify-center">
              {qr ? (
                <QrReveal src={qr} />
              ) : qrFailed ? (
                <p className="text-sm text-haze">QR code unavailable; use the link above.</p>
              ) : (
                <p className="text-sm text-haze">Generating QR code…</p>
              )}
            </div>
            <p className="text-sm text-haze">
              Expires <time dateTime={issued.expiresAt}>{formatExpiry(issued.expiresAt)}</time> if not started.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The QR draws in top to bottom behind a scan line: the moment a link becomes real.
function QrReveal({ src }: { src: string }) {
  return (
    <div className="relative rounded-2xl bg-brand-gradient p-[3px]">
      <m.div
        className="relative overflow-hidden rounded-[13px] bg-mist p-3"
        initial={{ clipPath: "inset(0 0 100% 0)" }}
        animate={{ clipPath: "inset(0 0 0% 0)" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI generated in the browser */}
        <img src={src} alt="QR code for the test link" width={200} height={200} />
      </m.div>
      <m.span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-orchid shadow-[0_0_16px_4px_var(--orchid)]"
        initial={{ top: "2%", opacity: 1 }}
        animate={{ top: "98%", opacity: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
