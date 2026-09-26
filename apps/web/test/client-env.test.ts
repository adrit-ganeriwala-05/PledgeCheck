// Guards against leaking server secrets into browser bundles: any file marked
// "use client" may reference only the two NEXT_PUBLIC_* variables.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["app", "components", "lib", "hooks"];

const SERVER_ONLY_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "XAI_API_KEY",
  "ANALYZE_URL",
  "ANALYZE_SERVICE_KEY",
  "TIGER_DATABASE_URL",
  "SOLANA_RPC_URL",
  "SOLANA_SECRET_KEY",
  "SERVICE_KEY",
];

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx|mts)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

function isClientFile(source: string): boolean {
  const code = source.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "");
  return /^\s*["']use client["']/.test(code);
}

export function findViolations(source: string): string[] {
  if (!isClientFile(source)) return [];
  const hits = SERVER_ONLY_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
  if (/from\s+["']@\/lib\/env["']/.test(source)) hits.push('import "@/lib/env"');
  if (/from\s+["']@\/lib\/supabase\/admin["']/.test(source)) hits.push('import "@/lib/supabase/admin"');
  return hits;
}

describe("client components never reference server-only env", () => {
  it("detects a violation (scanner self-check)", () => {
    expect(findViolations('"use client";\nconst k = process.env.XAI_API_KEY;')).toEqual([
      "XAI_API_KEY",
    ]);
    expect(findViolations("const k = process.env.XAI_API_KEY;")).toEqual([]);
    expect(findViolations("'use client'\nprocess.env.NEXT_PUBLIC_SUPABASE_URL")).toEqual([]);
  });

  it("finds no server-only names in any \"use client\" file", () => {
    const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    expect(files.length).toBeGreaterThan(0);
    const violations = files
      .map((file) => ({ file: path.relative(ROOT, file), hits: findViolations(readFileSync(file, "utf8")) }))
      .filter((v) => v.hits.length > 0);
    expect(violations).toEqual([]);
  });
});
