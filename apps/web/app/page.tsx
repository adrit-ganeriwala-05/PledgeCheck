import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-semibold tracking-widest text-[var(--color-brand)] uppercase">
        PledgeCheck
      </p>
      <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
        The FDA now lets isotretinoin patients test at home, but only if the clinic can
        trust the result.
      </h1>
      <p className="text-lg text-[var(--color-muted)]">
        PledgeCheck is how the clinic trusts it: a one-time link, a live photo with a
        challenge code, two independent readers, and a tamper-evident record the
        dermatologist approves in one tap.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link
          href="/queue"
          className="rounded-lg bg-[var(--color-brand)] px-5 py-3 font-medium text-white hover:bg-[var(--color-brand-dark)]"
        >
          Clinic sign in
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-[var(--color-line)] bg-white px-5 py-3 font-medium hover:bg-slate-50"
        >
          Drug-maker dashboard
        </Link>
      </div>
      <p className="pt-6 text-sm text-[var(--color-muted)]">
        Built at HackGT 13. Every patient in this demo is synthetic.
      </p>
    </main>
  );
}
