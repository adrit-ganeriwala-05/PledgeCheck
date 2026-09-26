// Photo reuse detection by perceptual hash (64-bit pHash from the analyze service, 16 hex).
//
// A photo matches an earlier one when the Hamming distance is < REUSE_DISTANCE (PRD).
// Every earlier submission with a phash is compared, across all practices: a reused photo
// is fraud wherever it came from. A linear scan in pages of 1000 is fine at hackathon
// scale; a BK-tree or bucketing would replace it at real volume.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export const REUSE_DISTANCE = 8;
const PAGE_SIZE = 1000;
const PHASH_RE = /^[0-9a-f]{16}$/i;

export class PhashFormatError extends Error {
  constructor() {
    super("phash must be 16 hex characters");
    this.name = "PhashFormatError";
  }
}

export function isPhash(value: string): boolean {
  return PHASH_RE.test(value);
}

/** Bits that differ between two 64-bit hashes. Throws on anything but 16 hex characters. */
export function hamming(a: string, b: string): number {
  if (!isPhash(a) || !isPhash(b)) throw new PhashFormatError();
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    count += Number(x & BigInt(1));
    x >>= BigInt(1);
  }
  return count;
}

export type ClosestMatch = { submissionId: string; distance: number };

/** The closest earlier submission by phash, or null when there is none to compare. */
export async function findClosestPhash(
  db: SupabaseClient | ReturnType<typeof createAdminClient>,
  phash: string,
  excludeSubmissionId?: string,
): Promise<ClosestMatch | null> {
  if (!isPhash(phash)) throw new PhashFormatError();

  let best: ClosestMatch | null = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await (db as SupabaseClient)
      .from("submissions")
      .select("id, phash")
      .not("phash", "is", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("could not read earlier photo hashes");

    const rows = (data ?? []) as { id: string; phash: string | null }[];
    for (const row of rows) {
      if (row.id === excludeSubmissionId || !row.phash || !isPhash(row.phash)) continue;
      const distance = hamming(phash, row.phash);
      if (!best || distance < best.distance) best = { submissionId: row.id, distance };
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Interface the submission pipeline was built against (labib/p0-integrated).
// ---------------------------------------------------------------------------

export interface ReuseCheck {
  reused: boolean;
  /** The closest earlier submission, when one is close enough to matter. */
  matchedSubmissionId?: string;
  distance?: number;
}

/**
 * Compare this photo's hash with every earlier one. Like the interim version, a malformed
 * hash or a failed read is logged and reported as not reused, so the pipeline never fails
 * on it; the second reader and the prescriber still see the photo.
 */
export async function checkReuse(
  db: SupabaseClient,
  phash: string,
  excludeSubmissionId?: string,
): Promise<ReuseCheck> {
  try {
    const best = await findClosestPhash(db, phash, excludeSubmissionId);
    if (!best || best.distance >= REUSE_DISTANCE) return { reused: false };
    return { reused: true, matchedSubmissionId: best.submissionId, distance: best.distance };
  } catch (err) {
    console.error("[reuse] check skipped", err instanceof Error ? err.message : "unknown");
    return { reused: false };
  }
}
