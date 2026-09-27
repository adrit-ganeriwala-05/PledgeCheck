// Which endpoints answer from the mock adapter (lib/api/mocks). Mocks never run in production.
//
//   NEXT_PUBLIC_API_MOCKS=1    mock only the endpoints the backend hasn't built ("pending").
//                              Every endpoint is "live" today, so this mode is a no-op; it
//                              stays for the next endpoint that gets built UI-first.
//   NEXT_PUBLIC_API_MOCKS=all  mock everything, including Supabase auth and the live
//                              endpoints, for an offline demo with no Supabase project
//
// When the backend ships an endpoint, flip it from "pending" to "live" here.

export const ENDPOINTS = {
  // Live today. The v3 portal and refill endpoints below landed with the backend merge:
  // enrolment and refill requests are real routes, and the cycle and the clinic inbox are
  // server actions over RLS (lib/api/server-reads.ts). Nothing here is pending any more.
  clinics: "live",
  patientEnroll: "live",
  patientCycle: "live",
  refillCreate: "live",
  refillList: "live",
  refillApprove: "live",
  refillDecline: "live",
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
  // Every endpoint is "live" today, so "pending" mocks nothing. The comparison is written
  // against the wider union so adding one pending endpoint back needs no change here.
  return mode === "all" || (ENDPOINTS[endpoint] as "live" | "pending") === "pending";
}

export function mockedEndpoints(): Endpoint[] {
  return (Object.keys(ENDPOINTS) as Endpoint[]).filter(isMocked);
}
