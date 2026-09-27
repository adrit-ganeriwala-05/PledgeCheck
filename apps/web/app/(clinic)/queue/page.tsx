import type { Metadata } from "next";

import { QueueBoard } from "@/components/queue/queue-board";

export const metadata: Metadata = { title: "Review queue · PledgeCheck" };

export default function QueuePage() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Review queue</h1>
        <p className="max-w-2xl text-sm text-haze">
          Each test passed the fraud checks and was read independently by Grok and OpenCV. The reads are
          evidence; the decision is yours.
        </p>
      </header>
      <QueueBoard />
    </main>
  );
}
