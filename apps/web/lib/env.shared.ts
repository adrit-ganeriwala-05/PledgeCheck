import type { z } from "zod";

export class MissingEnvError extends Error {
  constructor(name: string, detail: string) {
    super(`Environment variable ${name} ${detail}. Set it in apps/web/.env.local or in Vercel.`);
    this.name = "MissingEnvError";
  }
}

export function readEnv<T extends z.ZodType<string>>(
  name: string,
  value: string | undefined,
  schema: T,
): z.infer<T> {
  if (value === undefined || value === "") {
    throw new MissingEnvError(name, "is not set");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // Never echo the value itself: it may be a secret.
    throw new MissingEnvError(name, "is invalid");
  }
  return parsed.data;
}
