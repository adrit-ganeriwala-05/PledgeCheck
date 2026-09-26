// Photo reuse detection by perceptual hash.
//
// Owner: Nihalika (ticket N3). Interim version by Labib so L4 could run end to
// end; the threshold and the query are the parts worth tuning Saturday.

import type { SupabaseClient } from "@supabase/supabase-js";
import { hammingDistance } from "@/lib/ai/analyze";

/** Starting value from the PRD. Tune on the team's real test photos Saturday. */
export const REUSE_DISTANCE = 8;

export interface ReuseCheck {
  reused: boolean;
  /** The closest earlier submission, when one is close enough to matter. */
  matchedSubmissionId?: string;
  distance?: number;
}

/**
 * Compare this photo's hash with every earlier one. A near-duplicate means the
 * patient re-sent an old photo, or a lightly cropped or brightened copy of it.
 */
export async function checkReuse(
  db: SupabaseClient,
  phash: string,
  excludeSubmissionId?: string,
): Promise<ReuseCheck> {
  const { data, error } = await db
    .from("submissions")
    .select("id, phash")
    .not("phash", "is", null);

  if (error || !data) return { reused: false };

  let best: { id: string; distance: number } | null = null;

  for (const row of data as { id: string; phash: string }[]) {
    if (row.id === excludeSubmissionId) continue;
    const distance = hammingDistance(phash, row.phash);
    if (!best || distance < best.distance) best = { id: row.id, distance };
  }

  if (!best || best.distance > REUSE_DISTANCE) return { reused: false };

  return { reused: true, matchedSubmissionId: best.id, distance: best.distance };
}
