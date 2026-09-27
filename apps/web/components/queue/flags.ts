// Flag labels and severities for the review queue. Flags are set by the submissions pipeline
// (app/api/submissions/route.ts) and the fraud checks. Unknown flags are never dropped: they
// render as their raw value with an "unknown" severity.
//
// Severity decides how a flag looks, never what the prescriber may do:
//   fraud    - a fraud check failed (red)
//   degraded - a check or reader did not run, so the card is not a clean pass (amber)
//   review   - worth a closer look (amber)
export type FlagSeverity = "fraud" | "degraded" | "review";

type FlagInfo = { label: string; severity: FlagSeverity };

export const FLAGS: Record<string, FlagInfo> = {
  // Reader outcomes.
  readers_disagree: { label: "Readers disagree", severity: "review" },
  low_confidence: { label: "Low confidence", severity: "review" },
  grok_unavailable: { label: "Grok read unavailable", severity: "degraded" },
  opencv_unavailable: { label: "OpenCV read unavailable", severity: "degraded" },
  // Challenge code.
  code_mismatch: { label: "Code mismatch", severity: "fraud" },
  code_missing: { label: "Code missing", severity: "review" },
  code_missing_or_wrong: { label: "Code missing or wrong", severity: "fraud" },
  // Link and photo reuse.
  already_used: { label: "Link already used", severity: "fraud" },
  photo_reused: { label: "Photo already used", severity: "fraud" },
  photo_already_used: { label: "Photo already used", severity: "fraud" },
  reuse_check_unavailable: { label: "Photo-reuse check didn't run", severity: "degraded" },
  // Rules engine.
  window_logic_unavailable: { label: "Window logic unavailable", severity: "degraded" },
};

export const FLAG_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(FLAGS).map(([flag, info]) => [flag, info.label]),
);

export function flagLabel(flag: string): { label: string; known: boolean } {
  const label = FLAG_LABELS[flag];
  return label ? { label, known: true } : { label: flag, known: false };
}

export function flagSeverity(flag: string): FlagSeverity | "unknown" {
  return FLAGS[flag]?.severity ?? "unknown";
}

const SEVERITY_ORDER: Record<FlagSeverity | "unknown", number> = { fraud: 0, degraded: 1, review: 2, unknown: 3 };

/** Most serious first; stable within a severity. */
export function sortFlags(flags: string[]): string[] {
  return [...flags].sort((a, b) => SEVERITY_ORDER[flagSeverity(a)] - SEVERITY_ORDER[flagSeverity(b)]);
}

/**
 * Plain statements of what did not run, for the banner at the top of a card. A degraded card
 * must never look like a clean pass.
 */
export function degradedNotes(card: {
  flags: string[];
  grok: { result: string | null };
  opencv: { result: string | null };
}): string[] {
  const notes: string[] = [];
  const grokMissing = card.flags.includes("grok_unavailable") || card.grok.result === null;
  const cvMissing = card.flags.includes("opencv_unavailable") || card.opencv.result === null;
  if (grokMissing && cvMissing) notes.push("Neither reader ran. There is no independent read of this photo.");
  else if (cvMissing) notes.push("Only one reader ran. OpenCV did not read this photo.");
  else if (grokMissing) notes.push("Only one reader ran. Grok did not read this photo, so no code was read.");
  if (card.flags.includes("reuse_check_unavailable")) {
    notes.push("Photo-reuse check didn't run. This photo was not compared with earlier submissions.");
  }
  return notes;
}
