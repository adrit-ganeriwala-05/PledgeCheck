"use client";

// A link between entry pages. On a plain click it tells the stage where the visitor is going before the
// route commits (so the model moves at once), and swallows a second click on the same destination.
// Scrolling is left to the shell, which resets it after the old page has faded out.
import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";

import { useEntry } from "./entry-context";

type Props = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

export function EntryLink({ href, onClick, ...props }: Props) {
  const entry = useEntry();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (!entry || event.defaultPrevented) return;
    // New tabs and windows are none of the stage's business.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!entry.intend(href)) event.preventDefault();
  }
  return <Link href={href} scroll={false} onClick={handleClick} {...props} />;
}
