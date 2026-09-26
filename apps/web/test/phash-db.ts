// Paging double for the phash scan: from("submissions").select().not().order().range(a, b)
// resolves to rows[a..b], and records each range requested.
export function phashDb(rows: { id: string; phash: string | null }[], error: { message: string } | null = null) {
  const ranges: [number, number][] = [];
  const builder = {
    select: () => builder,
    not: () => builder,
    order: () => builder,
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null };
    },
  };
  return { client: { from: () => builder }, ranges };
}

/** A 16-hex phash that differs from "0000000000000000" in exactly `bits` bits. */
export function phashWithBits(bits: number): string {
  return ((BigInt(1) << BigInt(bits)) - BigInt(1)).toString(16).padStart(16, "0");
}
