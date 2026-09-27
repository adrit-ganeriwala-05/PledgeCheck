import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/portal/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password · PledgeCheck" };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
