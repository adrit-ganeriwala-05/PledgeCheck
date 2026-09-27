// The one source of truth for where the 3D test sits on each entry page. The stage reads the route
// from the pathname, looks up the target pose for the current layout, and damps toward it every frame.
// Home has no fixed pose: its target is the scroll story's pose (see stage-canvas.tsx).

export type Layout = "wide" | "narrow";
export type EntryRoute = "home" | "patient" | "patient-signup" | "clinician";
export type Role = "patient" | "clinician";
export type LightPreset = "balanced" | "rose" | "orchid";

export type V3 = [number, number, number];

export type Pose = {
  cam: V3;
  look: V3;
  /** The test's origin (its window sits near it). */
  pos: V3;
  /** Euler XYZ: tilt toward the viewer, yaw, roll. */
  rot: V3;
  scale: number;
  /** 0-1: how far the cap lifts off. */
  cap: number;
  light: LightPreset;
};

// Wide: desktop and landscape tablets, card on the right. Narrow: phones, card below the model.
// JS and CSS use the same query, so the DOM layout and the camera never disagree.
export const WIDE_QUERY = "(min-width: 900px) and (min-aspect-ratio: 7/5)";

export function layoutFor(width: number, height: number): Layout {
  return width >= 900 && width / height >= 1.4 ? "wide" : "narrow";
}

export const AUTH_PATHS = {
  patient: "/portal/login",
  "patient-signup": "/portal/signup",
  clinician: "/login",
} as const;

/** Which entry page a pathname is, or null outside the entry group. */
export function entryRoute(pathname: string | null): EntryRoute | null {
  switch (pathname) {
    case "/":
      return "home";
    case AUTH_PATHS.patient:
      return "patient";
    case AUTH_PATHS["patient-signup"]:
      return "patient-signup";
    case AUTH_PATHS.clinician:
      return "clinician";
    default:
      return null;
  }
}

export function roleOf(route: EntryRoute): Role | null {
  if (route === "clinician") return "clinician";
  if (route === "patient" || route === "patient-signup") return "patient";
  return null;
}

/** Only ever the control line: every pose shows a developed control line and never a test line. */
export const POSES: Record<Layout, Record<Exclude<EntryRoute, "home">, Pose>> = {
  wide: {
    // Turned to face the viewer, cap eased off, left of the card.
    patient: {
      cam: [0, 8.4, 44],
      look: [-0.6, 2.8, 0],
      pos: [-5.2, 3.1, 0.4],
      rot: [0.98, -0.2, 0.08],
      scale: 0.68,
      cap: 0.32,
      light: "rose",
    },
    // A small acknowledgement of the other tab: a quarter-turn's worth of the way round, no more.
    "patient-signup": {
      cam: [0, 8.4, 44],
      look: [-0.6, 2.8, 0],
      pos: [-5.2, 3.1, 0.4],
      rot: [0.98, 0.14, -0.06],
      scale: 0.68,
      cap: 0.32,
      light: "rose",
    },
    // Lying on the review desk at an angle, result window up, seen from above.
    clinician: {
      cam: [0, 21, 38],
      look: [-1.2, 0.4, 0],
      pos: [-5.4, 0.15, 1.2],
      rot: [0, 0.62, 0],
      scale: 0.76,
      cap: 0,
      light: "orchid",
    },
  },
  narrow: {
    patient: {
      cam: [0, 12, 52],
      look: [0, -4.2, 0],
      pos: [0.4, 5, 0],
      rot: [0.98, -0.42, 0.34],
      scale: 0.6,
      cap: 0.32,
      light: "rose",
    },
    "patient-signup": {
      cam: [0, 12, 52],
      look: [0, -4.2, 0],
      pos: [0.4, 5, 0],
      rot: [0.98, -0.12, 0.3],
      scale: 0.6,
      cap: 0.32,
      light: "rose",
    },
    clinician: {
      cam: [0, 22, 48],
      look: [0, -8.6, 0],
      pos: [0.6, 0.15, 0],
      rot: [0, -0.86, 0],
      scale: 0.72,
      cap: 0,
      light: "orchid",
    },
  },
};

/** Rim-light intensities in the studio environment. Home keeps today's balance. */
export const LIGHTS: Record<LightPreset, { rose: number; orchid: number }> = {
  balanced: { rose: 14, orchid: 14 },
  rose: { rose: 26, orchid: 3 },
  orchid: { rose: 3, orchid: 26 },
};

export function lightFor(route: EntryRoute, layout: Layout): LightPreset {
  return route === "home" ? "balanced" : POSES[layout][route].light;
}

/** Pre-rendered stills of each pose, rendered from the live scene (scripts/render-entry-stills.mjs). */
export type StillKey = "home" | "patient" | "clinician";

export const STILLS: Record<StillKey, Record<Layout, string>> = {
  home: { wide: "/brand/landing-wide.webp", narrow: "/brand/landing-narrow.webp" },
  patient: { wide: "/brand/entry-patient-wide.webp", narrow: "/brand/entry-patient-narrow.webp" },
  clinician: { wide: "/brand/entry-clinician-wide.webp", narrow: "/brand/entry-clinician-narrow.webp" },
};

export function stillFor(route: EntryRoute): StillKey {
  return route === "patient-signup" ? "patient" : route;
}
