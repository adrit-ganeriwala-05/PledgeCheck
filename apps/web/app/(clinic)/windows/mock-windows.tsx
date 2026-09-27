"use client";

// Offline demo only (NEXT_PUBLIC_API_MOCKS=all): windows from the mock adapter instead of the
// server-side Supabase read.
import { useEffect, useState } from "react";

import { WindowList, type WindowRow } from "./window-list";

export function MockWindows() {
  const [rows, setRows] = useState<WindowRow[] | null>(null);
  useEffect(() => {
    void import("@/lib/api/mocks").then((m) =>
      setRows(m.mockWindows().filter((w) => w.status !== "filled").sort((a, b) => Date.parse(a.closesAt) - Date.parse(b.closesAt))),
    );
  }, []);
  return rows ? <WindowList rows={rows} /> : <p className="text-sm text-haze">Loading windows…</p>;
}
