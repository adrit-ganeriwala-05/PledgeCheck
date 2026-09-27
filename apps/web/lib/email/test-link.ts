// The email a patient gets when their refill is approved: the one-time test link.
// It carries the link only. The challenge code stays hidden until the patient taps Start.
// Subjects stay neutral (no pregnancy or test type): they show on lock screens and previews.

import type { EmailMessage } from "./send";

type Language = "en" | "es";

const COPY: Record<
  Language,
  { subject: string; intro: string; steps: string[]; button: string; expires: string; ignore: string }
> = {
  en: {
    subject: "Your PledgeCheck link",
    intro: "Your clinician approved your refill request. The next step is a pregnancy test.",
    steps: [
      "Open the link below on your phone and tap Start.",
      "Write the code it shows you on the test, then take the test.",
      "When the result is ready, take a live photo in the app.",
    ],
    button: "Start my test",
    expires: "This link works once and expires",
    ignore: "If you did not request a refill, ignore this email and contact your clinic.",
  },
  es: {
    subject: "Su enlace de PledgeCheck",
    intro: "Su médico aprobó su solicitud de resurtido. El siguiente paso es una prueba de embarazo.",
    steps: [
      "Abra el enlace en su teléfono y toque Comenzar.",
      "Escriba en la prueba el código que aparece y luego haga la prueba.",
      "Cuando el resultado esté listo, tome una foto en vivo en la aplicación.",
    ],
    button: "Comenzar mi prueba",
    expires: "Este enlace funciona una sola vez y vence el",
    ignore: "Si no solicitó un resurtido, ignore este correo y comuníquese con su clínica.",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatExpiry(expiresAt: string, language: Language): string {
  return new Date(expiresAt).toLocaleString(language === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

export function testLinkEmail(input: {
  to: string;
  link: string;
  expiresAt: string;
  language?: Language;
}): EmailMessage {
  const copy = COPY[input.language ?? "en"];
  const expiry = formatExpiry(input.expiresAt, input.language ?? "en");
  const link = escapeHtml(input.link);

  const text = [
    copy.intro,
    "",
    ...copy.steps.map((step, i) => `${i + 1}. ${step}`),
    "",
    input.link,
    "",
    `${copy.expires} ${expiry}.`,
    "",
    copy.ignore,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#faf7fb;font-family:Arial,Helvetica,sans-serif;color:#1a1020">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
    <p style="margin:0 0 20px;font-size:20px;font-weight:bold">PledgeCheck</p>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.5">${escapeHtml(copy.intro)}</p>
    <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.6">
      ${copy.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("\n      ")}
    </ol>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#7a2e8e;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:8px">${escapeHtml(copy.button)}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#5b4a63">${escapeHtml(copy.expires)} ${escapeHtml(expiry)}.</p>
    <p style="margin:0 0 16px;font-size:13px;color:#5b4a63;word-break:break-all">${link}</p>
    <p style="margin:0;font-size:12px;color:#8a7a92">${escapeHtml(copy.ignore)}</p>
  </div>
</body></html>`;

  return { to: input.to, subject: copy.subject, html, text };
}
