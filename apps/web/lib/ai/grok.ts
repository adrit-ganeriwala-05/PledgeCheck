// Grok vision read of a pregnancy test photo. Owner: Labib (ticket L2).
//
// This is one of the two independent readers. It returns what it saw and how
// sure it is; it never decides anything. The rules engine does that.
//
// Qualifies the project for SpaceXAI: the core AI read runs on xAI's Grok.

import { z } from "zod";

import { serverEnv } from "@/lib/env";

/** Exactly the shape we ask Grok for, and refuse to use anything else. */
export const grokReadSchema = z.object({
  result: z.enum(["positive", "negative", "invalid"]),
  code_read: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  notes: z.string().default(""),
});

export type GrokRead = z.infer<typeof grokReadSchema>;

const XAI_URL = "https://api.x.ai/v1/chat/completions";

// Override with XAI_MODEL if xAI renames the vision model during the weekend. Optional, so
// it is read directly rather than through serverEnv, which requires every name it knows.
const MODEL = process.env.XAI_MODEL ?? "grok-4";

const SYSTEM_PROMPT = `You read at-home pregnancy test photos for a clinical safety workflow.

A test has a control line (C) and a test line (T).
- Control line only: negative.
- Both control and test lines, even a faint test line: positive.
- No control line, or the window is unreadable, blurred or cropped: invalid.

The patient was told to write a 4-character code on the test with a pen.
Read that code exactly as written. If you cannot see a code, return null.

Reply with JSON only, no prose and no code fences, in exactly this shape:
{"result":"negative","code_read":"K7Q2","confidence":0.93,"notes":"control line clear, no test line"}

confidence is your own certainty in the result, from 0 to 1. Be honest: if the
photo is dark, angled or blurry, say so in notes and lower the confidence.`;

export class GrokReadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GrokReadError";
  }
}

/**
 * Ask Grok to read one photo. Retries once, because a single malformed JSON
 * reply is common and a second attempt is cheaper than failing the patient.
 */
export async function readTestPhoto(
  image: { base64: string; mimeType: string },
  options: { signal?: AbortSignal } = {},
): Promise<GrokRead> {
  // serverEnv throws MissingEnvError when the key is absent; the pipeline treats any
  // failure here as "Grok unavailable" and routes the submission to needs_review.
  let apiKey: string;
  try {
    apiKey = serverEnv.XAI_API_KEY;
  } catch (error) {
    throw new GrokReadError("XAI_API_KEY is not set", error);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await callGrok(apiKey, image, attempt, options.signal);
    } catch (error) {
      lastError = error;
      // A bad key or a refused request will not fix itself on a retry.
      if (error instanceof GrokReadError && error.message.startsWith("xAI rejected")) throw error;
    }
  }

  throw new GrokReadError("Grok did not return a usable read after two attempts", lastError);
}

async function callGrok(
  apiKey: string,
  image: { base64: string; mimeType: string },
  attempt: number,
  signal?: AbortSignal,
): Promise<GrokRead> {
  const response = await fetch(XAI_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "high" },
            },
            {
              type: "text",
              text:
                attempt === 1
                  ? "Read this test. JSON only."
                  : "Your last reply was not valid JSON in the required shape. Reply with JSON only.",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GrokReadError(`xAI rejected the request (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new GrokReadError("xAI returned an empty completion");

  const parsed = grokReadSchema.safeParse(extractJson(content));
  if (!parsed.success) {
    throw new GrokReadError(`Grok reply did not match the schema: ${parsed.error.message}`);
  }

  return normalize(parsed.data);
}

/** Grok sometimes wraps JSON in a fence or a sentence; take the first object. */
function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new GrokReadError("no JSON object in the reply");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/** Codes are compared case-insensitively; store them the way we compare them. */
function normalize(read: GrokRead): GrokRead {
  const code = read.code_read?.trim().toUpperCase();
  return { ...read, code_read: code ? code : null };
}
