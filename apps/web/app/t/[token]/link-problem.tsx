import { LINK_PROBLEM_TEXT, UI_TEXT, type Language, type LinkProblemState } from "@/lib/voice";

export function LinkProblem({ state, language }: { state: LinkProblemState; language: Language }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold tracking-widest text-[var(--pc-brand)] uppercase">
        PledgeCheck
      </p>
      <h1 className="text-2xl font-semibold">{UI_TEXT[language].linkProblem}</h1>
      <p className="text-[var(--pc-muted)]">{LINK_PROBLEM_TEXT[language][state]}</p>
    </main>
  );
}
