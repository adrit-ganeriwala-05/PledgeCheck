"use client";

import { ImageOffIcon } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Props = { url: string | null; pseudonym: string };

// Large photo; tap to open full size. Signed URLs expire after 5 minutes (the queue
// refetches), so a plain <img> is used instead of next/image.
export function PhotoViewer({ url, pseudonym }: Props) {
  if (!url) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 text-sm text-muted-foreground">
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
          className="block w-full overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={`Enlarge test photo for ${pseudonym}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
          <img src={url} alt={`Test photo submitted by ${pseudonym}`} className="aspect-[4/3] w-full object-contain bg-black" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-4xl">
        <DialogTitle>Test photo · {pseudonym}</DialogTitle>
        <DialogDescription className="sr-only">Full-size photo of the submitted test</DialogDescription>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
        <img src={url} alt={`Test photo submitted by ${pseudonym}, full size`} className="max-h-[80vh] w-full object-contain" />
      </DialogContent>
    </Dialog>
  );
}
