import { describe, expect, it } from "vitest";

import { loadChainPage, pageForSeq, ROWS_PER_PAGE } from "./load";

type Call = { method: string; args: unknown[] };

// Query double: count queries (head: true) return `count`, filtered by .gt("seq", n) over
// seqs 1..total; row queries honour .range() over seqs total..1 (newest first).
function fakeDb(total: number) {
  const calls: Call[][] = [];
  const from = () => {
    const log: Call[] = [];
    calls.push(log);
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "range", "gt", "not", "limit"]) {
      builder[m] = (...args: unknown[]) => {
        log.push({ method: m, args });
        return builder;
      };
    }
    builder.then = (resolve: (r: unknown) => unknown) => {
      const select = log.find((c) => c.method === "select");
      const head = (select?.args[1] as { head?: boolean } | undefined)?.head;
      if (head) {
        const gt = log.find((c) => c.method === "gt");
        const count = gt ? Math.max(0, total - (gt.args[1] as number)) : total;
        return Promise.resolve({ data: null, count, error: null }).then(resolve);
      }
      const [a, b] = log.find((c) => c.method === "range")!.args as [number, number];
      const seqs = Array.from({ length: total }, (_, i) => total - i).slice(a, b + 1);
      const data = seqs.map((seq) => ({
        seq,
        created_at: "2026-09-26T20:00:00+00:00",
        actor: "system",
        action: "window.missed",
        ref_id: null,
        prev_hash: "0".repeat(64), // test vector
        hash: "1".repeat(64), // test vector
      }));
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return builder;
  };
  return { db: { from } as unknown as Parameters<typeof loadChainPage>[0], calls };
}

describe("audit page loaders", () => {
  it("loads 50 rows per page, newest first, and normalizes timestamps", async () => {
    const { db } = fakeDb(120);
    const page = await loadChainPage(db, 2);
    expect(page).toMatchObject({ page: 2, pageCount: 3, total: 120 });
    expect(page.rows).toHaveLength(ROWS_PER_PAGE);
    expect(page.rows[0]).toMatchObject({ seq: 70, createdAt: "2026-09-26T20:00:00.000Z", refId: null });
    expect(page.rows.at(-1)?.seq).toBe(21);
  });

  it("clamps an out-of-range page and handles an empty log", async () => {
    expect((await loadChainPage(fakeDb(120).db, 99)).page).toBe(3);
    expect(await loadChainPage(fakeDb(0).db, 4)).toEqual({ rows: [], page: 1, pageCount: 1, total: 0 });
  });

  it("finds the page that holds a seq", async () => {
    const { db } = fakeDb(120);
    expect(await pageForSeq(db, 120)).toBe(1);
    expect(await pageForSeq(db, 71)).toBe(1);
    expect(await pageForSeq(db, 70)).toBe(2);
    expect(await pageForSeq(db, 1)).toBe(3);
  });
});
