// Patient capture page at /t/[token]. Owner: Labib (ticket L1).
//
// Server component: it checks the one-time link and hands the client component only
// what the patient needs. The challenge code never reaches this page: the client gets
// it from POST /api/t/:token/start when the patient taps Start, which begins the
// session. Opening the page, even twice, changes nothing.

import { isMocked } from "@/lib/api/mode";
import { getLinkStatus } from "@/lib/fraud/session";
import type { Language } from "@/lib/voice";

import { CaptureFlow } from "./capture-flow";
import { LinkProblem } from "./link-problem";

export const dynamic = "force-dynamic";

export default async function CapturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Offline demo (NEXT_PUBLIC_API_MOCKS=all): mock links skip the database; the mock adapter
  // answers Start and the upload. Never active in production.
  if (isMocked("testStart") && token.startsWith("mock-")) {
    return <CaptureFlow token={token} language="en" />;
  }
  // The patient has no account; getLinkStatus reads with the service role and returns
  // only the state, language and (while active) the deadline.
  let status: Awaited<ReturnType<typeof getLinkStatus>>;
  try {
    status = await getLinkStatus(token, new Date());
  } catch {
    return <LinkProblem state="error" language="en" />;
  }

  const language: Language = status.language ?? "en";
  if (status.state !== "ready" && status.state !== "active") {
    return <LinkProblem state={status.state} language={language} />;
  }

  return <CaptureFlow token={token} language={language} resumed={status.state === "active"} />;
}
