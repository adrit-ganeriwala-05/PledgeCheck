// Client for the second reader: Adrit's FastAPI + OpenCV service on Vultr.
// Owner: Labib (the caller); the service itself is ticket A4.
//
// Contract agreed Friday night (PRD v2, "API contracts"):
//   POST <ANALYZE_URL>/analyze, header X-Service-Key, multipart image
//   -> { result, controlLine, testLine, confidence, phash }
//
// ANALYZE_URL is the service BASE url (https://api.pledgecheck.tech), not the endpoint;
// the /analyze path is appended here. That is the convention in apps/analyze/CONTRACT.md.

import { z } from "zod";

import { serverEnv } from "@/lib/env";

export const analyzeSchema = z.object({
  result: z.enum(["positive", "negative", "invalid"]),
  controlLine: z.boolean(),
  testLine: z.boolean(),
  confidence: z.number().min(0).max(1),
  phash: z.string().min(1),
});

export type AnalyzeResult = z.infer<typeof analyzeSchema>;

export class AnalyzeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AnalyzeError";
  }
}

/** Send the photo to the Vultr image service and validate what comes back. */
export async function analyzePhoto(
  file: Blob,
  options: { signal?: AbortSignal } = {},
): Promise<AnalyzeResult> {
  let url: string;
  let key: string;
  try {
    url = `${serverEnv.ANALYZE_URL.replace(/\/+$/, "")}/analyze`;
    key = serverEnv.ANALYZE_SERVICE_KEY;
  } catch (error) {
    throw new AnalyzeError("the image service is not configured", error);
  }

  const body = new FormData();
  body.append("image", file, "test.jpg");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "X-Service-Key": key },
      body,
      signal: options.signal,
    });
  } catch (error) {
    throw new AnalyzeError("could not reach the image service", error);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AnalyzeError(`image service returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const parsed = analyzeSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AnalyzeError(`image service reply did not match the contract: ${parsed.error.message}`);
  }

  return parsed.data;
}

/** Hamming distance between two hex perceptual hashes. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (Number.isNaN(diff)) return Number.POSITIVE_INFINITY;
    distance += popcount(diff);
  }
  return distance;
}

function popcount(n: number): number {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}
