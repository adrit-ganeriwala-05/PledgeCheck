import { describeAgreement, describeCode, formatConfidence, formatRead } from "@/lib/clinic/format";
import type { QueueCard } from "@/lib/clinic/queue";
import { cn } from "@/lib/utils";

type Props = { card: QueueCard };

// Grok and OpenCV reads side by side. They are evidence for the prescriber, not a result.
export function ReadersPanel({ card }: Props) {
  return (
    <section aria-label="Independent reads" className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Reader title="Grok read" result={card.grok.result} confidence={card.grok.confidence} detail={describeCode(card.grok)} />
        <Reader title="OpenCV read" result={card.opencv.result} confidence={card.opencv.confidence} />
      </div>
      <p
        className={cn(
          "rounded-md px-2 py-1 text-sm font-medium",
          card.readersAgree ? "bg-muted text-foreground" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
        )}
      >
        {describeAgreement(card)}
      </p>
    </section>
  );
}

function Reader(props: { title: string; result: string | null; confidence: number | null; detail?: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{props.title}</p>
      <p className="text-base font-semibold capitalize">{formatRead(props.result)}</p>
      <p className="text-xs text-muted-foreground">Confidence {formatConfidence(props.confidence)}</p>
      {props.detail ? <p className="mt-1 text-xs">{props.detail}</p> : null}
    </div>
  );
}
