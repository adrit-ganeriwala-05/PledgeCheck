// Which endpoints answer from the mock adapter (lib/api/mocks). Mocks never run in production.
//
//   NEXT_PUBLIC_API_MOCKS=1    mock only the endpoints the backend hasn't built ("pending")
//   NEXT_PUBLIC_API_MOCKS=all  mock everything, including Supabase auth and the live
//                              endpoints, for an offline demo with no Supabase project
//
// When the backend ships an endpoint, flip it from "pending" to "live" here.

export const ENDPOINTS = {
  // Needed from backend (PRD v3)
  patientEnroll: "pending",
  patientCycle: "pending",
  refillCreate: "pending",
  patientTestLink: "pending",
  refillList: "pending",
  refillApprove: "pending",
  refillDecline: "pending",
  refillResend: "pending",
  enrollmentCode: "pending",
  portalStatus: "pending",
  // Live today
  auth: "live",
  issueLink: "live",
  homeTesting: "live",
  queue: "live",
  review: "live",
  pickup: "live",
  testStart: "live",
  testSubmit: "live",
  auditVerify: "live",
  anchor: "live",
  // Server-rendered screens that read Supabase directly
  patientsPage: "live",
  windowsPage: "live",
  clinicRole: "live",
} as const satisfies Record<string, "live" | "pending">;

export type Endpoint = keyof typeof ENDPOINTS;

export type MockMode = "off" | "pending" | "all";

export function mockMode(): MockMode {
  // Literal process.env reads so Next.js inlines them into client bundles.
  if (process.env.NODE_ENV === "production") return "off";
  const flag = process.env.NEXT_PUBLIC_API_MOCKS;
  if (flag === "1") return "pending";
  if (flag === "all") return "all";
  return "off";
}

export function isMocked(endpoint: Endpoint): boolean {
  const mode = mockMode();
  if (mode === "off") return false;
  return mode === "all" || ENDPOINTS[endpoint] === "pending";
}

export function mockedEndpoints(): Endpoint[] {
  return (Object.keys(ENDPOINTS) as Endpoint[]).filter(isMocked);
}
