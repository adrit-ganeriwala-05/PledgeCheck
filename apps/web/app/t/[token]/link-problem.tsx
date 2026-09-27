import { Wordmark } from "@/components/brand/wordmark";
import { LINK_PROBLEM_TEXT, UI_TEXT, type Language, type LinkProblemState } from "@/lib/voice";

export function LinkProblem({ state, language }: { state: LinkProblemState; language: Language }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-5">
      <Wordmark size="sm" />
      <div className="flex flex-1 flex-col justify-center gap-4 pb-16">
        <h1 className="text-[1.75rem] leading-tight font-semibold">{UI_TEXT[language].linkProblem}</h1>
        <p className="text-lg leading-relaxed text-haze">{LINK_PROBLEM_TEXT[language][state]}</p>
      </div>
    </main>
  );
}
