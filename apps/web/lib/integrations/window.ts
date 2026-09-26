// Adapter: approval window from the rules engine.
// Owner of the real logic: Labib (apps/web/lib/rules). Do not compute dates here.
//
// Expected contract:
//   openApprovalWindow({ patientId, submissionId, approvedAt })
//     patientId, submissionId: uuid strings
//     approvedAt: ISO 8601 timestamp of the prescriber's approval
//   resolves to { opensAt, closesAt, isFirstRx }
//     opensAt, closesAt: ISO 8601 timestamps (rules: first-Rx window closes 7 days after
//     verification; later months per the official iPLEDGE guide)
//     isFirstRx: whether this is the first prescription
//   The result is passed to public.submit_review, which inserts the windows row.
//
// To wire it: import Labib's exported function from "@/lib/rules" below, adapt its real
// signature to this contract, and return its result. Until then this throws, and
// POST /api/reviews answers 503 window_logic_unavailable for approvals without writing.
import { IntegrationUnavailableError } from "./errors";

export type ApprovalWindowInput = {
  patientId: string;
  submissionId: string;
  approvedAt: string;
};

export type ApprovalWindow = {
  opensAt: string;
  closesAt: string;
  isFirstRx: boolean;
};

export async function openApprovalWindow(input: ApprovalWindowInput): Promise<ApprovalWindow> {
  void input;
  throw new IntegrationUnavailableError("window");
}
