"use client";

// Shared state for the entry group (home and the sign-in pages). Values that change every frame are
// Motion values, so publishing them never re-renders React.
import { motionValue, type MotionValue } from "motion/react";
import { useRouter } from "next/navigation";
import { createContext, useContext } from "react";

export type EntryContextValue = {
  /** Scroll progress through the landing story, 0-1. Written by <Story />, read by the stage. */
  storyProgress: MotionValue<number>;
  /** The stage's vertical offset in px: it scrolls away with the end of the story, like a sticky element. */
  stageY: MotionValue<number>;
  /** Reduced motion, or no WebGL at all: the landing shows its static story. */
  staticStory: boolean;
  /** Called on a click, before the route commits, so the model starts moving at once. */
  intend: (href: string) => boolean;
  /** Fade the stage and the card out, then leave the entry group (after a successful sign-in). */
  leave: (href: string) => void;
  /** True only for the panels on the server-rendered first paint (they play a CSS entrance). */
  firstPaint: boolean;
};

export const EntryContext = createContext<EntryContextValue | null>(null);

// Outside the entry shell (unit tests render pages on their own) the story still needs somewhere to
// publish its progress.
let standalone: Pick<EntryContextValue, "storyProgress" | "stageY"> | null = null;

export function useEntryMotion(): Pick<EntryContextValue, "storyProgress" | "stageY"> {
  const context = useContext(EntryContext);
  if (context) return context;
  standalone ??= { storyProgress: motionValue(0), stageY: motionValue(0) };
  return standalone;
}

export function useEntry(): EntryContextValue | null {
  return useContext(EntryContext);
}

/** Leaves the entry group: with a fade inside the shell, directly anywhere else (the /t page, tests). */
export function useLeaveEntry(): (href: string) => void {
  const context = useContext(EntryContext);
  const router = useRouter();
  return (href) => (context ? context.leave(href) : router.replace(href));
}
