// Pure display helpers for the review queue. Reads are shown as evidence, never as a
// diagnosis. These format existing timestamps; they never project new dates.
import type { QueueCard } from "./queue";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function formatConfidence(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function formatRead(result: string | null): string {
  return result ?? "no read";
}

export function describeAgreement(card: Pick<QueueCard, "grok" | "opencv" | "readersAgree">): string {
  const grok = card.grok.result;
  const cv = card.opencv.result;
  if (grok && !cv) return `OpenCV read unavailable · Grok ${grok}`;
  if (!grok && cv) return `Grok read unavailable · OpenCV ${cv}`;
  if (!grok && !cv) return "Both reads unavailable";
  return card.readersAgree
    ? `Readers agree: Grok ${grok} · OpenCV ${cv}`
    : `Readers disagree: Grok ${grok} · OpenCV ${cv}`;
}

export function describeCode(grok: QueueCard["grok"]): string {
  if (grok.code === null) return "No code read";
  if (grok.codeMatches) return `Code read: ${grok.code} · matches the issued code`;
  return `Code read: ${grok.code} · does not match the issued code`;
}

// "closes in 5d 3h" / "closes in 4h" / "closed". `now` is injectable for tests.
export function describeWindowCountdown(closesAt: string, now: number = Date.now()): string {
  const left = Date.parse(closesAt) - now;
  if (left <= 0) return "Window closed";
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  if (days > 0) return `Window closes in ${days}d ${hours}h`;
  const minutes = Math.floor((left % HOUR) / 60000);
  return hours > 0 ? `Window closes in ${hours}h ${minutes}m` : `Window closes in ${minutes}m`;
}

export function describeCapturedAgo(capturedAt: string | null, now: number = Date.now()): string {
  if (!capturedAt) return "Capture time unknown";
  const ago = Math.max(0, now - Date.parse(capturedAt));
  if (ago < HOUR) return `Captured ${Math.max(1, Math.floor(ago / 60000))}m ago`;
  if (ago < DAY) return `Captured ${Math.floor(ago / HOUR)}h ago`;
  return `Captured ${Math.floor(ago / DAY)}d ${Math.floor((ago % DAY) / HOUR)}h ago`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
