// Tiger Data (TimescaleDB) warehouse: writes and reads. Owner: Labib (L7, L8).
//
// This store never sees a patient. It holds one row per access event with the
// practice, the week and how long the fill took, and nothing else. The
// drug-maker dashboard reads only from here.
//
// Events are written inline, in the same request that caused them; there is no
// background sync job to break during the demo.

import { Pool } from "pg";

import { serverEnv } from "@/lib/env";

export type AccessEvent = "verified" | "filled" | "missed" | "rejected";

export interface AccessEventInput {
  practiceId: string;
  event: AccessEvent;
  /** Days from a verified test to the prescription being picked up. */
  daysToFill?: number | null;
  time?: Date;
}

export interface WeeklyRow {
  week: string;
  event: AccessEvent;
  n: number;
  avgDaysToFill: number | null;
}

/** Counts below this are hidden, so no row can point at one person. */
export const SMALL_COUNT_FLOOR = 5;

let pool: Pool | null = null;

function getPool(): Pool | null {
  // Analytics are optional: without a warehouse the writes no-op and the dashboard is
  // empty, rather than the clinic flow failing. serverEnv throws when the name is unset.
  let connectionString: string;
  try {
    connectionString = serverEnv.TIGER_DATABASE_URL;
  } catch {
    return null;
  }

  pool ??= new Pool({
    connectionString: withoutSslMode(connectionString),
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  return pool;
}

/**
 * Record one de-identified event. Best effort: analytics must never be the
 * reason a dermatologist's approval fails, so a failure is logged, not thrown.
 */
export async function recordAccessEvent(input: AccessEventInput): Promise<boolean> {
  const db = getPool();
  if (!db) return false;

  try {
    await db.query(
      `INSERT INTO access_events (time, practice_id, event, days_to_fill)
       VALUES ($1, $2, $3, $4)`,
      [input.time ?? new Date(), input.practiceId, input.event, input.daysToFill ?? null],
    );
    return true;
  } catch (error) {
    console.error("tiger write failed", error);
    return false;
  }
}

/**
 * Weekly totals for the dashboard, with small counts suppressed.
 * Reads the continuous aggregate, not the raw hypertable.
 */
export async function weeklyAccess(weeks = 12): Promise<WeeklyRow[]> {
  const db = getPool();
  if (!db) return [];

  try {
    const { rows } = await db.query<{
      week: Date;
      event: AccessEvent;
      n: string;
      avg_days_to_fill: string | null;
    }>(
      `SELECT week, event, n, avg_days_to_fill
         FROM weekly_access
        WHERE week > now() - ($1 || ' weeks')::interval
        ORDER BY week DESC, event`,
      [weeks],
    );

    return rows
      .map((row) => ({
        week: row.week.toISOString(),
        event: row.event,
        n: Number(row.n),
        avgDaysToFill: row.avg_days_to_fill === null ? null : Number(row.avg_days_to_fill),
      }))
      .filter((row) => row.n >= SMALL_COUNT_FLOOR);
  } catch (error) {
    console.error("tiger read failed", error);
    return [];
  }
}

/**
 * Tiger hands you a url ending in `?sslmode=require` and serves a self-signed chain.
 * node-postgres escalates that sslmode to verify-full and the connection dies with
 * SELF_SIGNED_CERT_IN_CHAIN, overriding the `ssl` option set alongside it. Dropping the
 * parameter lets the explicit `ssl` above apply. Worth the care: recordAccessEvent
 * swallows failures by design, so this would have shown up only as a dashboard that
 * stayed empty for no visible reason.
 */
function withoutSslMode(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Whole days between a verification and a fill, for days_to_fill. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}
