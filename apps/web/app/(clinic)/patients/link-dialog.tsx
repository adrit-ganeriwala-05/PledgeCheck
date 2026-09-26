"use client";

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
    QRCode.toString(issued.link, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{issued?.setting === "clinic" ? "Clinic" : "Home"} test link for {pseudonym}</DialogTitle>
          <DialogDescription>Send this link to the patient, or let them scan the code.</DialogDescription>
        </DialogHeader>
        {issued && (
          <div className="flex flex-col gap-4">
            <Alert role="note">
              <AlertDescription>{ONCE_WARNING}</AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label="Test link"
                value={issued.link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border px-2 py-1 font-mono text-xs"
              />
              <Button type="button" size="sm" onClick={copyLink}>
                {copy === "copied" ? "Copied" : "Copy"}
              </Button>
            </div>
            {copy === "failed" && (
              <p className="text-sm text-destructive">Could not copy. Select the link and copy it manually.</p>
            )}
            <div className="flex justify-center">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URI generated in the browser
                <img src={qr} alt="QR code for the test link" width={192} height={192} />
              ) : qrFailed ? (
                <p className="text-sm text-muted-foreground">QR code unavailable; use the link above.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Generating QR code…</p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Expires <time dateTime={issued.expiresAt}>{formatExpiry(issued.expiresAt)}</time> if not started.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
