import type { Metadata } from "next";

import { PatientAuth } from "@/components/entry/patient-auth";
import { safeNextPath } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "Patient sign in · PledgeCheck" };

// Rendered inside the entry layout's card; /portal/signup renders the same component on its other tab.
export default async function PatientLoginPage({ searchParams }: PageProps<"/portal/login">) {
  const { next } = await searchParams;
  return <PatientAuth next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}
