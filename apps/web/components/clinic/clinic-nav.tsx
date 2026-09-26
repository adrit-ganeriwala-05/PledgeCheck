// Minimal clinic navigation. Kept in one small component so it is easy to restyle or move.
import Link from "next/link";

import { SignOutButton } from "./sign-out-button";

export const CLINIC_LINKS = [
  { href: "/patients", label: "Patients" },
  { href: "/queue", label: "Queue" },
  { href: "/audit", label: "Audit" },
  { href: "/windows", label: "Windows" },
] as const;

export function ClinicNav() {
  return (
    <nav aria-label="Clinic" className="border-b">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-2">
        <span className="text-sm font-semibold">PledgeCheck</span>
        <ul className="flex flex-1 flex-wrap gap-3 text-sm">
          {CLINIC_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-muted-foreground hover:text-foreground">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <SignOutButton />
      </div>
    </nav>
  );
}
