import type { Metadata } from "next";

import { QueueBoard } from "@/components/queue/queue-board";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = { title: "Review queue · PledgeCheck" };

export default function QueuePage() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          Each test passed the fraud checks and was read independently by Grok and OpenCV. The reads are
          evidence; the decision is yours.
        </p>
      </header>
      <QueueBoard />
      <Toaster />
    </main>
  );
}
