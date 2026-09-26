// Server-side Supabase clients.
//
// Adrit owns lib/supabase (ticket A2). This is the minimum the submission
// pipeline needs so L1-L5 could be built before the schema landed; replace it
// with Adrit's generated types when A2 merges.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Bypasses row-level security. Server code only, never shipped to a browser. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Private bucket the capture page uploads into. */
export const PHOTO_BUCKET = "photos";
