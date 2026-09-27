// Validates a `next` return path so sign-in can never redirect off-site. Only same-origin,
// relative paths survive: absolute URLs, protocol-relative ("//evil.test"), backslash tricks
// ("/\evil.test") and control characters all fall back.

const BASE = "https://pledgecheck.invalid";

export function safeNextPath(raw: string | null | undefined, fallback = "/portal"): string {
  if (!raw || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
