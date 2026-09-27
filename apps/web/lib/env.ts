// Server-only environment. Importing this module from a client component fails the build.
// Validation is lazy: each variable is checked when it is read, so `next build` succeeds
// without teammate-owned values (xAI, Tiger Data, Solana), and a missing value throws a
// clear error at the point of use.
import "server-only";

import { z } from "zod";

import { readEnv } from "./env.shared";

export { publicEnv } from "./env.public";
export { MissingEnvError } from "./env.shared";

const nonEmpty = z.string().min(1);

function lazy(name: string, schema: z.ZodType<string>) {
  return () => readEnv(name, process.env[name], schema);
}

const readers = {
  SUPABASE_SERVICE_ROLE_KEY: lazy("SUPABASE_SERVICE_ROLE_KEY", nonEmpty),
  XAI_API_KEY: lazy("XAI_API_KEY", nonEmpty),
  ANALYZE_URL: lazy("ANALYZE_URL", z.url()),
  ANALYZE_SERVICE_KEY: lazy("ANALYZE_SERVICE_KEY", z.string().min(32)),
  TIGER_DATABASE_URL: lazy("TIGER_DATABASE_URL", nonEmpty),
  SOLANA_RPC_URL: lazy("SOLANA_RPC_URL", z.url()),
  SOLANA_SECRET_KEY: lazy("SOLANA_SECRET_KEY", nonEmpty),
  RESEND_API_KEY: lazy("RESEND_API_KEY", nonEmpty),
  // e.g. "PledgeCheck <links@pledgecheck.tech>"; the domain must be verified in Resend.
  EMAIL_FROM: lazy("EMAIL_FROM", nonEmpty),
} as const;

export type ServerEnvName = keyof typeof readers;

export const serverEnv = Object.defineProperties(
  {} as { readonly [K in ServerEnvName]: string },
  Object.fromEntries(
    Object.entries(readers).map(([name, read]) => [name, { get: read, enumerable: true }]),
  ),
);
