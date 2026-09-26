// Browser Supabase client. Uses only the public URL and anon key; RLS does the rest.
import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env.public";

import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
