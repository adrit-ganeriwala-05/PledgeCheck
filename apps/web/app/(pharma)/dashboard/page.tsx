// Drug-maker dashboard at /dashboard. Owner: Labib (ticket L8).
//
// Fed only by the Tiger Data continuous aggregate. No patient, no submission,
// no result tied to a person, and any week with fewer than 5 events is hidden.

import { SMALL_COUNT_FLOOR, weeklyAccess, type WeeklyRow } from "@/lib/analytics/tiger";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const rows = await weeklyAccess();
  const weeks = groupByWeek(rows);
  const totals = sumEvents(rows);
  const avgDays = weightedAverageDaysToFill(rows);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-widest text-[var(--pc-brand)] uppercase">
          PledgeCheck
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Therapy access, weekly</h1>
        <p className="mt-1 max-w-2xl text-[var(--pc-muted)]">
          De-identified totals from the Tiger Data <code>weekly_access</code> continuous
          aggregate. No patient-level data reaches this page, and any week with fewer
          than {SMALL_COUNT_FLOOR} events is hidden.
        </p>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-4">
        <Stat label="Tests verified" value={totals.verified} />
        <Stat label="Prescriptions filled" value={totals.filled} />
        <Stat label="Windows missed" value={totals.missed} />
        <Stat
          label="Avg days to fill"
          value={avgDays === null ? "—" : avgDays.toFixed(1)}
        />
      </section>

      {weeks.length === 0 ? (
        <p className="rounded-xl border border-[var(--pc-line)] bg-white p-8 text-center text-[var(--pc-muted)]">
          No weeks above the reporting floor yet. Approve a few tests and the aggregate
          fills in.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--pc-line)] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--pc-line)] text-[var(--pc-muted)]">
              <tr>
                <th className="px-5 py-3 font-medium">Week of</th>
                <th className="px-5 py-3 font-medium">Verified</th>
                <th className="px-5 py-3 font-medium">Filled</th>
                <th className="px-5 py-3 font-medium">Missed</th>
                <th className="px-5 py-3 font-medium">Avg days to fill</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.week} className="border-b border-[var(--pc-line)] last:border-0">
                  <td className="px-5 py-3">
                    {new Date(week.week).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{week.verified ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{week.filled ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{week.missed ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {week.avgDaysToFill === null ? "—" : week.avgDaysToFill.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-[var(--pc-line)] bg-white p-5">
      <p className="text-sm text-[var(--pc-muted)]">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

interface WeekSummary {
  week: string;
  verified?: number;
  filled?: number;
  missed?: number;
  rejected?: number;
  avgDaysToFill: number | null;
}

function groupByWeek(rows: WeeklyRow[]): WeekSummary[] {
  const byWeek = new Map<string, WeekSummary>();

  for (const row of rows) {
    const summary = byWeek.get(row.week) ?? { week: row.week, avgDaysToFill: null };
    summary[row.event] = row.n;
    if (row.event === "filled") summary.avgDaysToFill = row.avgDaysToFill;
    byWeek.set(row.week, summary);
  }

  return [...byWeek.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
}

function sumEvents(rows: WeeklyRow[]): Record<"verified" | "filled" | "missed", number> {
  const totals = { verified: 0, filled: 0, missed: 0 };
  for (const row of rows) {
    if (row.event in totals) totals[row.event as keyof typeof totals] += row.n;
  }
  return totals;
}

/** Average across weeks, weighted by how many fills each week held. */
function weightedAverageDaysToFill(rows: WeeklyRow[]): number | null {
  let weighted = 0;
  let count = 0;

  for (const row of rows) {
    if (row.event !== "filled" || row.avgDaysToFill === null) continue;
    weighted += row.avgDaysToFill * row.n;
    count += row.n;
  }

  return count === 0 ? null : weighted / count;
}
