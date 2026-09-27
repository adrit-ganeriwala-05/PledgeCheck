"use client";

// When to mount a live 3D canvas. Parsing three.js and compiling shaders are long main-thread
// tasks, so they never run while a page is becoming interactive:
//   - large screens with a fine pointer: once the page has loaded and gone idle
//   - phones and tablets: on the first interaction (tap, scroll, key) or after a quiet 7 s
// The poster, identical to the first frame, covers the wait.
import { useEffect, useState } from "react";

const PHONE_FALLBACK_MS = 7000;
let interacted = false;
const waiting = new Set<() => void>();

function markInteracted() {
  if (interacted) return;
  interacted = true;
  for (const fire of waiting) fire();
  waiting.clear();
}

if (typeof window !== "undefined") {
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const) {
    window.addEventListener(type, markInteracted, { once: true, passive: true, capture: true });
  }
}

export function useDeferredMount(enabled: boolean): boolean {
  const [mount, setMount] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fire = () => {
      if (!cancelled) setMount(true);
    };
    const desktop = window.matchMedia?.("(pointer: fine)").matches && window.innerWidth >= 1024;
    let timer: number | undefined;
    let idleId: number | undefined;
    const onLoad = () => {
      if (desktop) {
        const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
        idleId = ric(fire, { timeout: 2500 });
      } else if (interacted) {
        fire();
      } else {
        waiting.add(fire);
        timer = window.setTimeout(fire, PHONE_FALLBACK_MS);
      }
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      cancelled = true;
      waiting.delete(fire);
      window.removeEventListener("load", onLoad);
      if (timer !== undefined) window.clearTimeout(timer);
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
    };
  }, [enabled]);
  return mount;
}
