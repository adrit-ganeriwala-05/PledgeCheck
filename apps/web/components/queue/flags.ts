// Known flag labels. The flag vocabulary is not final (set by the submissions pipeline and
// fraud checks), so unknown flags are never dropped: they render as their raw value.
export const FLAG_LABELS: Record<string, string> = {
  readers_disagree: "Readers disagree",
  low_confidence: "Low confidence",
  code_mismatch: "Code mismatch",
  code_missing: "Code missing",
  photo_reused: "Photo already used",
  grok_unavailable: "Grok read unavailable",
  opencv_unavailable: "OpenCV read unavailable",
};

export function flagLabel(flag: string): { label: string; known: boolean } {
  const label = FLAG_LABELS[flag];
  return label ? { label, known: true } : { label: flag, known: false };
}
