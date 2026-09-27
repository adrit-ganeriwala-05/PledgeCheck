import type { Metadata } from "next";

import { ClinicianSignIn } from "./login-form";

export const metadata: Metadata = { title: "Sign in · PledgeCheck" };

// Rendered inside the entry layout's card, orchid-accented.
export default function LoginPage() {
  return <ClinicianSignIn />;
}
