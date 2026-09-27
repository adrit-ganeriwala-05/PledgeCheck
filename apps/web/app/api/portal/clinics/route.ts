// GET /api/portal/clinics — the practices a patient can enrol with, for the signup form.
// Owner: Labib.
//
// Public on purpose: a patient has no session yet when they pick their clinic. It returns
// practice names and prescriber display names only - the names of the people whose door
// you would walk through - and no patient data of any kind.
//
// Served by the service role because anon has no read privilege on these tables and is
// not being given one: a single route returning two columns is a smaller surface than a
// policy that opens the tables to the public internet.

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const { data, error } = await createAdminClient()
    .from("practices")
    .select("id, name, clinicians(display_name, role)")
    .order("name");

  if (error) {
    console.error("[portal/clinics] load failed", { cause: error.message });
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const clinics = (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      name: string;
      clinicians: { display_name: string; role: string }[] | null;
    };
    return {
      id: r.id,
      name: r.name,
      prescribers: (r.clinicians ?? []).filter((c) => c.role === "prescriber").map((c) => c.display_name),
    };
  });

  return NextResponse.json({ clinics });
}
