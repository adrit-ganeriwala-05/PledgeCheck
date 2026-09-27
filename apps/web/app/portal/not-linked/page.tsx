import type { Metadata } from "next";

export const metadata: Metadata = { title: "Almost there · PledgeCheck" };

// A signed-in user with no patients row. Not an error: it is what every new signup looks
// like until a clinician links the account to a clinical record. Enrolment in an iPLEDGE
// practice is not something a patient can do for themselves.
export default function NotLinkedPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
      <p className="text-sm text-muted-foreground">
        Your account exists, but your clinic has not linked it to your record yet. Ask them to add you
        using the email address you signed up with, then sign in again.
      </p>
      <p className="text-sm text-muted-foreground">
        Nothing about your care is shown here until they do.
      </p>
    </main>
  );
}
