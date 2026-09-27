// Renders the sign-in poses' stills from the live 3D stage, so the first paint, reduced motion and
// no-WebGL fallbacks show exactly what the canvas draws.
//
//   pnpm build && pnpm start -p 3200
//   node scripts/render-entry-stills.mjs http://localhost:3200
//
// Sizes match the landing posters: wide 2800x2000, narrow 1200x2860 (both taller than any viewport in
// their layout, so object-cover crops them exactly like the camera, which keeps its horizontal field of
// view constant). Wide renders at the high tier (desktop), narrow at the medium tier (phones).
import { createRequire } from "node:module";
import path from "node:path";

import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

const BASE = process.argv[2] ?? "http://localhost:3200";
const OUT = path.join(import.meta.dirname, "..", "public", "brand");
const SHOTS = [
  { route: "/portal/login", name: "patient" },
  { route: "/login", name: "clinician" },
];
const LAYOUTS = [
  { name: "wide", viewport: { width: 1400, height: 1000 } },
  { name: "narrow", viewport: { width: 600, height: 1430 } },
];

const browser = await chromium.launch({ args: ["--enable-gpu", "--use-angle=metal"] });
for (const layout of LAYOUTS) {
  const context = await browser.newContext({ viewport: layout.viewport, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    window.__PC_STILL__ = true;
  });
  const page = await context.newPage();
  for (const shot of SHOTS) {
    await page.goto(BASE + shot.route);
    await page.addStyleTag({ content: ".entry-content, nextjs-portal { visibility: hidden !important; }" });
    await page.waitForSelector('[data-canvas="shown"]', { timeout: 30000 });
    // Let the damping, the line and the environment settle completely.
    await page.waitForTimeout(3000);
    const png = await page.screenshot({ type: "png" });
    const file = path.join(OUT, `entry-${shot.name}-${layout.name}.webp`);
    await sharp(png).webp({ quality: 86 }).toFile(file);
    console.log("wrote", path.relative(process.cwd(), file));
  }
  await context.close();
}
await browser.close();
