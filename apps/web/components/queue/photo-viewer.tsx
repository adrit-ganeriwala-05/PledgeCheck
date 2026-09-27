"use client";

import { ImageOffIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Props = { url: string | null; pseudonym: string };

const ZOOM = 2.5;

// Photo thumbnail; tap to open full size, then tap the photo to zoom into that spot. Signed URLs
// expire after 5 minutes (the queue refetches), so a plain <img> is used instead of next/image.
export function PhotoViewer({ url, pseudonym }: Props) {
  if (!url) {
    return (
      <div className="flex aspect-4/3 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-ink/40 text-sm text-haze">
        <ImageOffIcon className="size-6" aria-hidden />
        Photo unavailable
      </div>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group relative block w-full overflow-hidden rounded-xl border border-line bg-black focus-visible:ring-2 focus-visible:ring-orchid focus-visible:outline-none"
          aria-label={`Enlarge test photo for ${pseudonym}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
          <img src={url} alt={`Test photo submitted by ${pseudonym}`} className="aspect-4/3 w-full object-contain" />
          <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-ink/80 px-2 py-1 text-xs text-mist opacity-90 group-hover:opacity-100">
            <ZoomInIcon className="size-3.5" aria-hidden /> Zoom
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] border-line bg-surface sm:max-w-4xl">
        <DialogTitle>Test photo · {pseudonym}</DialogTitle>
        <DialogDescription>Tap the photo to zoom into the result window or the code.</DialogDescription>
        <ZoomablePhoto url={url} pseudonym={pseudonym} />
      </DialogContent>
    </Dialog>
  );
}

function ZoomablePhoto({ url, pseudonym }: { url: string; pseudonym: string }) {
  const [origin, setOrigin] = useState<string | null>(null);

  function toggle(e: MouseEvent<HTMLButtonElement>) {
    if (origin) return setOrigin(null);
    const rect = e.currentTarget.getBoundingClientRect();
    // Keyboard activation has no pointer position: zoom into the center.
    const x = e.clientX ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
    const y = e.clientY ? ((e.clientY - rect.top) / rect.height) * 100 : 50;
    setOrigin(`${x}% ${y}%`);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={origin !== null}
      aria-label={origin ? "Zoom out" : "Zoom in"}
      className="relative block w-full overflow-hidden rounded-lg bg-black"
      style={{ cursor: origin ? "zoom-out" : "zoom-in" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img
        src={url}
        alt={`Test photo submitted by ${pseudonym}, full size`}
        className="max-h-[78vh] w-full object-contain transition-transform duration-300 ease-weighted"
        style={{ transform: origin ? `scale(${ZOOM})` : "none", transformOrigin: origin ?? "50% 50%" }}
      />
      <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-ink/80 px-2 py-1 text-xs text-mist">
        {origin ? <ZoomOutIcon className="size-3.5" aria-hidden /> : <ZoomInIcon className="size-3.5" aria-hidden />}
        {origin ? "Zoom out" : "Zoom in"}
      </span>
    </button>
  );
}
