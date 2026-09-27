import { CheckIcon, CircleDashedIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { describeAgreement, formatConfidence, formatRead } from "@/lib/clinic/format";
import type { QueueCard } from "@/lib/clinic/queue";
import { cn } from "@/lib/utils";

type Props = { card: QueueCard };

type Agreement = "agree" | "disagree" | "partial";

function agreementOf(card: QueueCard): Agreement {
  if (card.grok.result === null || card.opencv.result === null) return "partial";
  return card.readersAgree ? "agree" : "disagree";
}

const AGREEMENT_STYLE: Record<Agreement, { icon: typeof CheckIcon; className: string }> = {
  agree: { icon: CheckIcon, className: "border-ok/35 bg-ok/10 text-ok" },
  disagree: { icon: TriangleAlertIcon, className: "border-warn/40 bg-warn/10 text-warn" },
  partial: { icon: CircleDashedIcon, className: "border-warn/40 bg-warn/10 text-warn" },
};

// Grok and OpenCV reads side by side. They are evidence for the prescriber, not a result.
export function ReadersPanel({ card }: Props) {
  const agreement = agreementOf(card);
  const style = AGREEMENT_STYLE[agreement];
  const Icon = style.icon;
  return (
    <section aria-label="Independent reads" className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Reader title="Grok read" result={card.grok.result} confidence={card.grok.confidence} />
        <Reader title="OpenCV read" result={card.opencv.result} confidence={card.opencv.confidence} />
      </div>
      <p
        data-agreement={agreement}
        className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium", style.className)}
      >
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{describeAgreement(card)}</span>
      </p>
      <CodeRow grok={card.grok} />
    </section>
  );
}

function Reader(props: { title: string; result: string | null; confidence: number | null }) {
  const missing = props.result === null;
  const pct = props.confidence === null ? 0 : Math.round(props.confidence * 100);
  return (
    <div className={cn("rounded-lg border border-line bg-ink/40 p-3", missing && "border-dashed")}>
      <p className="text-xs text-haze">{props.title}</p>
      <p className={cn("mt-0.5 text-lg font-semibold capitalize", missing ? "text-haze" : "text-mist")}>
        {formatRead(props.result)}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-line"
          role="meter"
          aria-label={`${props.title} confidence`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full rounded-full bg-orchid" style={{ width: `${pct}%` }} />
        </div>
        <p className="tabular text-xs text-haze">Confidence {formatConfidence(props.confidence)}</p>
      </div>
    </div>
  );
}

// The code Grok read off the photo, and whether it matches the code issued with the link.
// The queue API returns the match, not the issued code itself.
function CodeRow({ grok }: { grok: QueueCard["grok"] }) {
  if (grok.code === null) {
    return (
      <p className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-2 text-sm">
        <span className="text-haze">Challenge code</span>
        <span className="font-medium text-warn">No code read</span>
      </p>
    );
  }
  return (
    <p className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
      <span className="text-haze">
        Code read <span className="tabular ml-1 text-base font-semibold tracking-[0.18em] text-mist">{grok.code}</span>
      </span>
      {grok.codeMatches ? (
        <span className="inline-flex items-center gap-1 font-medium text-ok">
          <CheckIcon className="size-4" aria-hidden /> Matches issued code
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 font-medium text-stop">
          <XIcon className="size-4" aria-hidden /> Doesn&apos;t match issued code
        </span>
      )}
    </p>
  );
}
