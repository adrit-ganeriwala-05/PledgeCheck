import { CheckIcon, CircleDashedIcon, SirenIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { describeAgreement, formatConfidence, formatRead } from "@/lib/clinic/format";
import type { QueueCard } from "@/lib/clinic/queue";
import { cn } from "@/lib/utils";

import { clinicalAlert } from "./flags";
import { LOW_CONFIDENCE_DISPLAY_THRESHOLD } from "./review-reasons";

type Props = { card: QueueCard };

type Agreement = "agree" | "disagree" | "partial" | "clinical";

function agreementOf(card: QueueCard): Agreement {
  if (clinicalAlert(card)) return "clinical";
  if (card.grok.result === null || card.opencv.result === null) return "partial";
  return card.readersAgree ? "agree" : "disagree";
}

const AGREEMENT_STYLE: Record<Agreement, { icon: typeof CheckIcon; className: string }> = {
  agree: { icon: CheckIcon, className: "border-ok/35 bg-ok/10 text-ok" },
  disagree: { icon: TriangleAlertIcon, className: "border-warn/40 bg-warn/10 text-warn" },
  partial: { icon: CircleDashedIcon, className: "border-warn/40 bg-warn/10 text-warn" },
  clinical: { icon: SirenIcon, className: "border-stop/60 bg-stop/10 text-stop" },
};

// Grok and OpenCV reads side by side. They are evidence for the prescriber, not a result.
// Once a test line has been seen (faint or clear), no read is shown as "negative": a faint line
// counts as positive on most home tests, so the card says so and keeps the reported value as a note.
export function ReadersPanel({ card }: Props) {
  const lineSeen = clinicalAlert(card) !== null;
  const agreement = agreementOf(card);
  const style = AGREEMENT_STYLE[agreement];
  const Icon = style.icon;
  return (
    <section aria-label="Independent reads" className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Reader title="Grok read" result={card.grok.result} confidence={card.grok.confidence} lineSeen={lineSeen} />
        <Reader title="OpenCV read" result={card.opencv.result} confidence={card.opencv.confidence} lineSeen={lineSeen} />
      </div>
      <p
        data-agreement={agreement}
        className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium", style.className)}
      >
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{lineSeen ? "Test line seen: don't treat this test as negative" : describeAgreement(card)}</span>
      </p>
      <GrokFields grok={card.grok} />
      <CodeRow grok={card.grok} />
    </section>
  );
}

const TEST_LINE: Record<"none" | "faint" | "clear", { text: string; className: string }> = {
  none: { text: "None seen", className: "text-mist" },
  faint: { text: "Faint: possible positive", className: "font-semibold text-stop" },
  clear: { text: "Clear: positive", className: "font-semibold text-stop" },
};

// What Grok reported, field by field (PRD R8). A field the pipeline didn't send reads
// "Not reported", never as a clean value.
function GrokFields({ grok }: { grok: QueueCard["grok"] }) {
  const control = grok.controlLine;
  const line = grok.testLine ? TEST_LINE[grok.testLine] : null;
  const low = grok.confidence !== null && grok.confidence < LOW_CONFIDENCE_DISPLAY_THRESHOLD;
  return (
    <dl aria-label="What Grok reported" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-line px-3 py-2 text-sm">
      <dt className="text-haze">Control line</dt>
      <dd data-field="control-line" className={cn("text-right", control === false ? "font-semibold text-stop" : control ? "text-mist" : "text-haze")}>
        {control === true ? "Present" : control === false ? "Missing: test invalid" : "Not reported"}
      </dd>
      <dt className="text-haze">Test line</dt>
      <dd data-field="test-line" className={cn("text-right", line ? line.className : "text-haze")}>
        {line ? line.text : "Not reported"}
      </dd>
      <dt className="text-haze">Grok confidence</dt>
      <dd data-field="confidence" className={cn("tabular text-right", low ? "font-medium text-warn" : "text-mist")}>
        {formatConfidence(grok.confidence)}
        {low ? " · below 85%" : ""}
      </dd>
    </dl>
  );
}

function Reader(props: { title: string; result: string | null; confidence: number | null; lineSeen?: boolean }) {
  const missing = props.result === null;
  const pct = props.confidence === null ? 0 : Math.round(props.confidence * 100);
  const overridden = props.lineSeen === true && props.result === "negative";
  return (
    <div className={cn("rounded-lg border border-line bg-ink/40 p-3", missing && "border-dashed", overridden && "border-stop/50")}>
      <p className="text-xs text-haze">{props.title}</p>
      {overridden ? (
        <>
          <p data-overridden className="mt-0.5 text-lg font-semibold text-stop">
            Possible positive
          </p>
          <p className="text-xs text-haze">Reported negative, but a test line was seen</p>
        </>
      ) : (
        <p className={cn("mt-0.5 text-lg font-semibold first-letter:uppercase", missing ? "text-haze" : "text-mist")}>
          {formatRead(props.result)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <div
          className="h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-line"
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
    <p className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
      <span className="text-haze">
        Code read <span className="tabular ml-1 text-base font-semibold tracking-[0.08em] text-mist">{grok.code}</span>
        {grok.expectedCode ? (
          <>
            {" "}
            · issued <span className="tabular ml-1 font-semibold tracking-[0.08em] text-mist">{grok.expectedCode}</span>
          </>
        ) : null}
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
