"use client";

// Keeps an exiting panel showing the page it had, not the page being navigated to. The App Router
// swaps a layout's children as soon as the new route commits; AnimatePresence keeps the old element
// mounted for its exit, but that element would read the new route from context and render the new
// page. While a panel is exiting, this hands it the router context it last had while present.
//
// LayoutRouterContext is internal to Next.js (this is the pattern Motion's own docs point to for the
// App Router). If an upgrade renames it, exits degrade to showing the new page during the fade; the
// e2e suite checks the exiting panel's content.
import { useIsPresent } from "motion/react";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useContext, useState, type ReactNode } from "react";

export function FrozenRouter({ children }: { children: ReactNode }) {
  const live = useContext(LayoutRouterContext);
  const present = useIsPresent();
  const [frozen, setFrozen] = useState(live);
  // Derived state: follow the live context while present, keep the last one while exiting.
  if (present && frozen !== live) setFrozen(live);
  return <LayoutRouterContext.Provider value={present ? live : frozen}>{children}</LayoutRouterContext.Provider>;
}

/** The same idea for any value derived from the route (the role, the section). */
export function useFrozenWhileExiting<T>(value: T): T {
  const present = useIsPresent();
  const [frozen, setFrozen] = useState(value);
  if (present && frozen !== value) setFrozen(value);
  return present ? value : frozen;
}
