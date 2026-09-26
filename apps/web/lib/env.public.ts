// Public (browser-safe) environment. Only the two NEXT_PUBLIC_* values live here.
// Each getter references process.env.NEXT_PUBLIC_* literally so Next.js can inline it
// into client bundles. Validation is lazy: a missing value throws where it is used,
// never at import or build time.
import { z } from "zod";

import { MissingEnvError, readEnv } from "./env.shared";

export const publicEnv = {
  get NEXT_PUBLIC_SUPABASE_URL(): string {
    return readEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, z.url());
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY(): string {
    return readEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      z.string().min(1),
    );
  },
};

export { MissingEnvError };
