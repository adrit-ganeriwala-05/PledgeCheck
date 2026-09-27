"use client";

// Clinic navigation. Kept in one small component so it is easy to restyle or move.
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/brand/wordmark";
import { clinicLinksFor, type ClinicRole } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

import { SignOutButton } from "./sign-out-button";

export function ClinicNav({ role = null }: { role?: ClinicRole | null }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Clinic" className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-6 sm:px-4">
        <Wordmark size="sm" className="hidden sm:inline-flex" />
        <ul className="flex flex-1 gap-0.5 overflow-x-auto text-sm sm:gap-1">
          {clinicLinksFor(role).map((link) => {
            const current = pathname?.startsWith(link.href) ?? false;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-2.5 font-medium transition-colors sm:px-3",
                    current ? "bg-raised text-mist shadow-[inset_0_-2px_0_var(--orchid)]" : "text-haze hover:bg-surface hover:text-mist",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {role ? (
          <span className="hidden text-xs text-haze md:inline">{role === "prescriber" ? "Prescriber" : "Staff"}</span>
        ) : null}
        <SignOutButton />
      </div>
    </nav>
  );
}
