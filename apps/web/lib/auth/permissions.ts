// Who may do what in the clinic, in one place. "Who approves refill requests" and "who records
// pickup" are open PRD decisions: change them here and the nav and screens follow. The backend
// enforces its own checks; this map only decides what the UI offers.

export type ClinicRole = "prescriber" | "staff";

export const PERMISSIONS = {
  "requests.review": ["staff", "prescriber"],
  "patients.view": ["staff", "prescriber"],
  "enrollment.generate": ["staff", "prescriber"],
  "links.issue": ["staff", "prescriber"],
  "results.review": ["prescriber"],
  "windows.view": ["staff", "prescriber"],
  "pickup.record": ["staff", "prescriber"],
  "audit.view": ["staff", "prescriber"],
} as const satisfies Record<string, readonly ClinicRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: ClinicRole | null, permission: Permission): boolean {
  return role !== null && (PERMISSIONS[permission] as readonly ClinicRole[]).includes(role);
}

export const CLINIC_LINKS = [
  { href: "/requests", label: "Requests", permission: "requests.review" },
  { href: "/patients", label: "Patients", permission: "patients.view" },
  { href: "/queue", label: "Queue", permission: "results.review" },
  { href: "/windows", label: "Windows", permission: "windows.view" },
  { href: "/audit", label: "Audit", permission: "audit.view" },
] as const satisfies readonly { href: string; label: string; permission: Permission }[];

/**
 * Links for a role. With the role unknown (the lookup failed; the page itself will redirect),
 * show what every clinician may see.
 */
export function clinicLinksFor(role: ClinicRole | null) {
  return CLINIC_LINKS.filter((link) =>
    role === null ? PERMISSIONS[link.permission].length === 2 : can(role, link.permission),
  );
}

/** Where each role lands after sign-in. */
export const ROLE_HOME: Record<ClinicRole, string> = {
  prescriber: "/queue",
  staff: "/requests",
};
