import type { Metadata } from "next";

import { RequestsInbox } from "@/components/requests/requests-inbox";
import { can } from "@/lib/auth/permissions";
import { clinicRole } from "@/lib/clinic/role";

export const metadata: Metadata = { title: "Refill requests · PledgeCheck" };
export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const role = await clinicRole();
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold sm:text-4xl">Refill requests</h1>
        <p className="max-w-2xl text-sm text-haze">
          Patients request their monthly refill from the portal. Approve to email them a one-time test link, or decline
          with a reason they&apos;ll see.
        </p>
      </header>
      {role !== null && !can(role, "requests.review") ? (
        <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-haze">
          Your role can&apos;t handle refill requests.
        </p>
      ) : (
        <RequestsInbox />
      )}
    </main>
  );
}
