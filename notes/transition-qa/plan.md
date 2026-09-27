# Entry transitions: plan

## Findings from the existing code

- `next.config.ts` is empty: no experimental View Transitions flag, nothing to conflict with.
- The landing story owns its own `<Canvas>` (`components/landing/story-canvas.tsx`), keyed by layout, so a
  resize across the 900 px breakpoint remounts it. `/login` and `/portal/*` are separate root pages with a
  still image. Every navigation between them tears the canvas down.
- `Story` probes WebGL with `hasWebGL()`, which creates (and loses) a WebGL context of its own.
- `PatientSignInForm` is shared with `/t/[token]` (out of scope), so the entry pages get their own panel and
  the `/t` form stays untouched.
- No password-reset code exists anywhere.
- `maath` (drei's easing library) was in the store but not a direct dependency; Playwright was not installed.

## Route group

```
app/(entry)/layout.tsx           EntryShell: one persistent <EntryStage/> + AnimatePresence panels
app/(entry)/page.tsx             /              (moved from app/page.tsx)
app/(entry)/login/page.tsx       /login         (moved; login-form.tsx and its test move with it)
app/(entry)/portal/login/page.tsx   /portal/login   (moved)
app/(entry)/portal/signup/page.tsx  /portal/signup  (moved)
```

Unchanged, outside the group: `app/login/{continue,no-access,sign-out}`, `app/login/destination.ts`,
`app/portal/page.tsx`, `app/t/*`, clinic, pharma and API routes. No URL changes.

## Components (`components/entry/`)

| File | Role |
| --- | --- |
| `poses.ts` | Pure: pathname → entry route, pose map per layout, lighting presets, stills, layout media query |
| `entry-context.tsx` | Shared motion values (story progress, stage offset), navigation intent, leave-the-group fade |
| `entry-shell.tsx` | Stage + panels. Outer `AnimatePresence` keyed home/auth, inner keyed by role, frozen router |
| `entry-stage.tsx` | Fixed stage: pose stills (first paint, reduced motion, no WebGL), canvas mount, context loss |
| `stage-canvas.tsx` | The one R3F canvas: story scene + pose damping (`maath/easing`), rebakeable studio lights |
| `auth-card.tsx` | Card shell, auto-height on swaps, role switch |
| `patient-auth.tsx` | Tabs (Sign in / Create account), forgot password, `pushState` tab URLs |
| `fields.tsx` | Field, password show/hide, blur validation, animated errors, fixed-width submit |
| `entry-link.tsx` | `Link` with intent (the model reacts on click) and a double-click guard |

## Pose model

A target pose per route and layout: camera position and look, model position, rotation, scale, cap lift,
and a lighting preset. Home's target is the scroll story's pose at the current scroll progress (plus idle
sway and pointer tilt, weighted by a damped "home" factor so they ease out). Every frame the stage damps the
current state toward the target (`damp3`, `dampQ`, `damp`, critically damped, so an interruption continues
from wherever the model is).

| Route | Wide (card right) | Narrow (card below) | Light |
| --- | --- | --- | --- |
| `/` | scroll story | scroll story | rose and orchid balanced |
| `/portal/login` | faces viewer, cap lifted, left | faces viewer, smaller, top | rose |
| `/portal/signup` | same, small turn | same, small turn | rose |
| `/login` | flat, angled, window up, left | flat, angled, top | orchid |

## Timings

| Time | What happens |
| --- | --- |
| 0 ms | click: press feedback, intent set, model starts damping, navigation starts |
| 0–220 ms | hero copy fades up, staggered 40 ms |
| 220–650 ms | auth card fades and rises in, fields stagger 45 ms |
| ~650 ms | first field focused (fine pointers only) |
| 0–1000 ms | model settles (smooth time 0.38 s), lights cross-fade |

## Checks

Playwright (`apps/web/e2e`): functional flows against the mock API (dev, `NEXT_PUBLIC_API_MOCKS=all`), and
smoothness metrics (context count, rAF deltas, long tasks, CLS, console) against a production build.
Evidence in `notes/transition-qa/`.
