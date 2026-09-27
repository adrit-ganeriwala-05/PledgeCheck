// Shared choreography for the entry pages. Weighted easing, no overshoot anywhere.
import type { Transition, Variants } from "motion/react";

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Items that stagger in (fields, hero lines). Parents drive them through the variant labels. */
export const ITEM: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE } },
  exit: { opacity: 0, y: -12, transition: { duration: 0.16, ease: EASE } },
};

export function staggered(reduced: boolean, delay = 0.06): Transition {
  return reduced ? { duration: 0.15 } : { delayChildren: delay, staggerChildren: 0.045 };
}
