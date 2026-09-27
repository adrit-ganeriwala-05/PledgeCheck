// The landing page below the story: the problem, how it works, why it's trustworthy, privacy.
// Static on purpose: the story above is the page's one orchestrated moment.
import { CheckIcon, ClockIcon, FingerprintIcon, ImagesIcon, KeyRoundIcon, Link2Icon, ScanEyeIcon } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className="border-t border-line">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-24 md:grid-cols-[1.1fr_1fr] md:py-32">
        <div>
          <h2 id="problem-title" className="text-4xl font-semibold sm:text-5xl">
            Once a month: a drive, a waiting room, a missed lecture.
          </h2>
          <div className="mt-8 max-w-xl space-y-4 text-lg leading-relaxed text-mist/85">
            <p>
              A college student on isotretinoin has to prove she isn&apos;t pregnant every month. That means driving to
              the clinic, sitting in the waiting room and missing class for a five-minute test.
            </p>
            <p>
              Then the clock starts. Her prescription has to be filled within seven days of the test. When a busy week
              pushes her past the window, she starts over, and loses treatment progress she already paid for in side
              effects.
            </p>
            <p className="text-mist">
              PledgeCheck gives her that afternoon back, and gives her doctor a record they can defend.
            </p>
          </div>
        </div>
        <FillWindow />
      </div>
    </section>
  );
}

// The 7-day window after a test, drawn as seven days.
function FillWindow() {
  return (
    <figure className="self-end rounded-3xl border border-line bg-surface p-6">
      <figcaption className="flex items-center gap-2 text-sm text-haze">
        <ClockIcon className="size-4" aria-hidden /> The fill window after each test
      </figcaption>
      <ol className="mt-5 grid grid-cols-7 gap-1.5" aria-label="Days 1 to 7">
        {Array.from({ length: 7 }, (_, i) => (
          <li key={i} className="flex flex-col items-center gap-2">
            <span
              className={
                i < 5
                  ? "h-16 w-full rounded-lg bg-orchid/25"
                  : i === 5
                    ? "h-16 w-full rounded-lg bg-warn/30"
                    : "h-16 w-full rounded-lg bg-stop/35"
              }
            />
            <span className="tabular text-xs text-haze">{i + 1}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-sm leading-relaxed text-haze">
        Day 1 is the test. Miss day 7 and the patient needs a new test before the pharmacy can fill.
      </p>
    </figure>
  );
}

const PATIENT_STEPS = [
  { title: "Open the link", body: "Scan the QR code from the dermatologist. No app, no account." },
  { title: "Tap Start, get a code", body: "A 4-character code appears only now. Write it on the test." },
  { title: "Photograph the test", body: "Camera only. Nothing can be uploaded from the gallery." },
  { title: "Done", body: "The photo goes to the clinic. The app never shows a result; the doctor decides." },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-24 md:py-32">
        <h2 id="how-title" className="max-w-2xl text-4xl font-semibold sm:text-5xl">
          Four steps for the patient. One tap for the prescriber.
        </h2>
        <div className="mt-14 grid gap-12 lg:grid-cols-[1fr_1fr]">
          <ol className="space-y-8">
            {PATIENT_STEPS.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[3rem_1fr] gap-4">
                <span className="tabular font-display text-4xl leading-none font-semibold text-orchid-text">{i + 1}</span>
                <div>
                  <h3 className="text-xl font-semibold">{step.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-haze">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <p className="mb-4 text-sm text-haze">What the prescriber sees, one card per test:</p>
            <SampleCard />
          </div>
        </div>
      </div>
    </section>
  );
}

// A static picture of a queue card, built from the same parts as the real one.
function SampleCard() {
  return (
    <figure aria-label="Example review card" className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-haze">Ready for review</p>
          <p className="font-display text-xl font-semibold">
            PT-1042 <span className="font-sans text-sm font-normal text-haze">phase during · EN</span>
          </p>
        </div>
        <p className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm">
          <ClockIcon className="size-3.5" aria-hidden /> Captured 3m ago
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[
          ["Grok read", "96%"],
          ["OpenCV read", "93%"],
        ].map(([name, conf]) => (
          <div key={name} className="rounded-lg border border-line bg-ink/40 p-3">
            <p className="text-xs text-haze">{name}</p>
            <p className="mt-0.5 text-lg font-semibold">Read complete</p>
            <p className="tabular text-xs text-haze">Confidence {conf}</p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 flex items-center gap-2 rounded-lg border border-ok/35 bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
        <CheckIcon className="size-4" aria-hidden /> Readers agree
      </p>
      <p className="mt-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
        <span className="text-haze">
          Code read <span className="tabular ml-1 font-semibold tracking-[0.08em] text-mist">K7R4</span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-ok">
          <CheckIcon className="size-4" aria-hidden /> Matches issued code
        </span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4" aria-hidden>
        <span className="inline-flex h-11 items-center justify-center rounded-lg bg-rose font-semibold text-black">
          Approve test
        </span>
        <span className="inline-flex h-11 items-center justify-center rounded-lg border border-line font-medium">
          Reject test
        </span>
      </div>
      <figcaption className="mt-3 text-xs text-haze">Approving opens the 7-day fill window.</figcaption>
    </figure>
  );
}

const TRUST = [
  {
    icon: KeyRoundIcon,
    title: "A challenge code",
    body: "Each link gets its own code, shown only after the patient taps Start. It has to appear in the photo, written on the test.",
  },
  {
    icon: ScanEyeIcon,
    title: "Two independent readers",
    body: "A vision model and a separate OpenCV reader read every photo in parallel. When they disagree, or one didn't run, the card says so.",
  },
  {
    icon: ImagesIcon,
    title: "Photo-reuse detection",
    body: "Every photo is compared against earlier submissions by perceptual hash, so last month's photo can't be sent again.",
  },
  {
    icon: Link2Icon,
    title: "A hash-linked audit chain",
    body: "Every decision is appended to a chain where each entry commits to the one before it, and the head is anchored on Solana.",
  },
];

export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="scroll-mt-20 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-24 md:py-32">
        <h2 id="trust-title" className="max-w-2xl text-4xl font-semibold sm:text-5xl">
          Built so a test can&apos;t be faked, and a decision can&apos;t be rewritten.
        </h2>
        <ul className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {TRUST.map(({ icon: Icon, title, body }) => (
            <li key={title} className="border-t border-line pt-6">
              <Icon className="size-6 text-orchid" aria-hidden />
              <h3 className="mt-4 text-xl font-semibold">{title}</h3>
              <p className="mt-2 max-w-md leading-relaxed text-haze">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Privacy() {
  return (
    <section aria-labelledby="privacy-title" className="border-t border-line">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-24 md:grid-cols-[1.3fr_1fr] md:py-32">
        <div>
          <h2 id="privacy-title" className="text-4xl font-semibold sm:text-5xl">
            Same patient every month, without storing who they are.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist/85">
            Patients are stored under pseudonyms. No names, no birthdates, no ID numbers. The clinic knows its
            patient; PledgeCheck only ever sees a pseudonym and a test.
          </p>
        </div>
        <div className="rounded-3xl border border-line bg-surface p-6">
          <p className="flex items-center gap-2 text-sm text-haze">
            <FingerprintIcon className="size-4" aria-hidden /> What PledgeCheck stores
          </p>
          <dl className="mt-5 space-y-3 text-sm">
            {[
              ["Patient", "PT-1042"],
              ["Name", "Not stored"],
              ["Date of birth", "Not stored"],
              ["ID number", "Not stored"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
                <dt className="text-haze">{k}</dt>
                <dd className={v === "PT-1042" ? "font-semibold text-mist" : "text-haze"}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-24 md:flex-row md:items-end md:justify-between">
        <h2 id="closing-title" className="max-w-xl text-4xl font-semibold sm:text-5xl">
          Run your practice&apos;s at-home testing on PledgeCheck.
        </h2>
        <Button asChild variant="brand" size="lg" className="h-12 px-6 text-base">
          <Link href="/login">Sign in as a clinician</Link>
        </Button>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-haze md:flex-row md:items-center md:justify-between">
        <Wordmark size="sm" />
        <p>Built at HackGT 13 by Labib, Adrit and Nihalika.</p>
        <p>A hackathon project, not affiliated with the FDA or the iPLEDGE program.</p>
      </div>
    </footer>
  );
}

export function LandingNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line/60 bg-ink/70 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" aria-label="PledgeCheck home" className="rounded-md">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <a href="#how" className="hidden rounded-md px-3 py-2 text-sm text-haze hover:text-mist sm:inline-block">
            How it works
          </a>
          <a href="#trust" className="hidden rounded-md px-3 py-2 text-sm text-haze hover:text-mist sm:inline-block">
            Why it&apos;s trustworthy
          </a>
          <Button asChild variant="outline" size="sm" className="h-9 px-3.5">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
