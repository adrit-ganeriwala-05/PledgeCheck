/**
 * Generate the patient voice clips with ElevenLabs. Owner: Labib (ticket L6).
 *
 * Run once, locally, and commit the mp3s. The clips are static files, so the
 * patient flow never waits on a live API call and an Expo rate limit cannot
 * break the demo.
 *
 *   ELEVENLABS_API_KEY=... npm run gen-voice --workspace apps/web
 *
 * The API key stays local. It is never set in Vercel, because nothing at
 * runtime calls ElevenLabs.
 *
 * No clip says the challenge code out loud: the code changes per link, so
 * every clip points at the code on the screen instead.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CAPTURE_STEPS, VOICE_SCRIPT, type Language } from "../apps/web/lib/voice";

const API = "https://api.elevenlabs.io/v1/text-to-speech";

// Multilingual voices, so English and Spanish sound like the same guide.
// Override with ELEVENLABS_VOICE_EN / _ES; ids are from the ElevenLabs library.
const VOICES: Record<Language, string> = {
  en: process.env.ELEVENLABS_VOICE_EN ?? "21m00Tcm4TlvDq8ikWAM", // Rachel
  es: process.env.ELEVENLABS_VOICE_ES ?? "XrExE9yKIg1WjnnlVkGX", // Matilda
};

const MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
const OUT_ROOT = join(import.meta.dirname, "..", "apps", "web", "public", "audio");

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set. Run this locally, never on Vercel.");
    process.exit(1);
  }

  let written = 0;

  for (const language of ["en", "es"] as Language[]) {
    const dir = join(OUT_ROOT, language);
    await mkdir(dir, { recursive: true });

    for (const step of CAPTURE_STEPS) {
      const text = VOICE_SCRIPT[language][step];
      const path = join(dir, `${step}.mp3`);

      process.stdout.write(`${language}/${step}.mp3 … `);
      const audio = await synthesize(apiKey, VOICES[language], text);
      await writeFile(path, audio);
      written++;
      console.log(`${(audio.length / 1024).toFixed(0)} KB`);
    }
  }

  console.log(`\n${written} clips written to apps/web/public/audio/. Commit them.`);
}

async function synthesize(apiKey: string, voiceId: string, text: string): Promise<Buffer> {
  const response = await fetch(`${API}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      // Calm and even: this is read to someone who may be anxious.
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.1 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
