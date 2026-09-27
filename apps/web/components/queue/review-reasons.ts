import { describeAgreement, formatConfidence } from "@/lib/clinic/format";
import type { QueueCard } from "@/lib/clinic/queue";

import { flagLabel, isPassedCheck } from "./flags";

// Rules-engine reasons that repeat a reason computed above from the reads themselves.
const REPEATS_READS = [/^only one reader returned a result$/, /^readers disagree\b/, /\bconfidence [\d.]+ is below\b/];

// Display-only threshold for calling a read "low confidence" on the card. The status
// itself (needs_review vs ready_for_review) is decided by the rules engine, not here.
export const LOW_CONFIDENCE_DISPLAY_THRESHOLD = 0.85;

// Specific reasons a card needs a closer look, in the order a prescriber should read them.
export function closerReviewReasons(card: QueueCard): string[] {
  const reasons: string[] = [];
  if (!card.readersAgree) reasons.push(describeAgreement(card));
  if (card.grok.confidence !== null && card.grok.confidence < LOW_CONFIDENCE_DISPLAY_THRESHOLD) {
    reasons.push(`Low Grok confidence (${formatConfidence(card.grok.confidence)})`);
  }
  if (card.opencv.confidence !== null && card.opencv.confidence < LOW_CONFIDENCE_DISPLAY_THRESHOLD) {
    reasons.push(`Low OpenCV confidence (${formatConfidence(card.opencv.confidence)})`);
  }
  if (card.grok.codeMatches === false) reasons.push("Code read does not match the issued code");
  for (const flag of card.flags) {
    if (isPassedCheck(flag) || REPEATS_READS.some((re) => re.test(flag))) continue;
    // Engine sentences read as reasons on their own; pipeline codes are labeled as flags.
    const label = /\s/.test(flag) ? flagLabel(flag).label : `Flag: ${flagLabel(flag).label}`;
    if (!reasons.includes(label)) reasons.push(label);
  }
  return reasons;
}
