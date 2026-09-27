import type { Metadata } from "next";

import { PatientAuth } from "@/components/entry/patient-auth";
import { safeNextPath } from "@/lib/auth/next-path";

export const metadata: Metadata = { title: "Create your account · PledgeCheck" };

// The patient card on its "Create account" tab (see /portal/login).
export default async function PatientSignupPage({ searchParams }: PageProps<"/portal/signup">) {
  const { next } = await searchParams;
  return <PatientAuth next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}
