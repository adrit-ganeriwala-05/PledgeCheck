// Smoothness and glitch measurements for the entry transitions, against a production build.
// Every number is written to notes/transition-qa/metrics-<project>.json with the renderer it came from.
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  disableWebGL,
  expectOnePanel,
  expectRoute,
  filmstrip,
  instrument,
  measure,
  QA_DIR,
  renderer,
  stageReady,
  summarize,
  watchConsole,
  writeJson,
  type Window,
} from "./support";

test.describe.configure({ mode: "serial" });

const results: Record<string, unknown> = {};
let gpu = "unknown";

test.afterAll(async ({}, info) => {
  writeJson(path.join(QA_DIR, `metrics-${info.project.name.replace("motion-", "")}.json`), {
    project: info.project.name,
    renderer: gpu,
    rendering: /swiftshader|llvmpipe|software/i.test(gpu) ? "software (headless SwiftShader)" : "GPU (headless Chromium, ANGLE)",
    cpuThrottle: throttleFor(info),
    ...results,
  });
});

/** Phones: 4x CPU slowdown, a rough stand-in for a mid-range phone's CPU (the GPU is still this machine's). */
function throttleFor(info: TestInfo) {
  return info.project.name.includes("mobile") ? 4 : 1;
}

async function setup(page: Page, info: TestInfo, { webgl = true } = {}) {
  await page.addInitScript(instrument);
  if (!webgl) await page.addInitScript(disableWebGL);
  const rate = throttleFor(info);
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  return watchConsole(page);
}

const heroLink = (page: Page, name: string) => page.locator("main").getByRole("link", { name }).first();
const card = (page: Page) => page.getByTestId("auth-card");

/** Wakes the canvas on phones (it mounts on the first interaction) with a tap on empty stage. */
async function wake(page: Page, isMobile: boolean) {
  if (isMobile) await page.touchscreen.tap(Math.round((page.viewportSize()?.width ?? 390) / 2), 180);
}

async function contexts(page: Page) {
  return page.evaluate(() => (window as unknown as { __qa: { contexts: number } }).__qa.contexts);
}

async function pageLoadCls(page: Page) {
  return page.evaluate(() => {
    const qa = (window as unknown as { __qa: { shifts: { value: number }[] } }).__qa;
    return +qa.shifts.reduce((s, x) => s + x.value, 0).toFixed(4);
  });
}

test("the full sequence: one canvas, frame timing, long tasks, layout shift, console", async ({ page, isMobile }, info) => {
  const problems = await setup(page, info);
  await page.goto("/");
  await wake(page, isMobile);
  await stageReady(page);
  await page.waitForTimeout(1500);
  const loadCls = await pageLoadCls(page);

  const windows: Window[] = [];
  const step = async (name: string, run: () => Promise<void>, path: string, route: string, panel: "home" | "auth") => {
    windows.push(await measure(page, name, run));
    await expectRoute(page, path, route);
    await expectOnePanel(page, panel);
  };

  await step("home → patient sign in", () => heroLink(page, "Patient sign in").click(), "/portal/login", "patient", "auth");
  await step("sign in → create account (tab)", () => page.getByRole("tab", { name: "Create account" }).click(), "/portal/signup", "patient-signup", "auth");
  await step("create account → sign in (tab)", () => page.getByRole("tab", { name: "Sign in" }).click(), "/portal/login", "patient", "auth");
  await step("patient → clinician", () => card(page).getByRole("link", { name: "Clinician sign in" }).click(), "/login", "clinician", "auth");
  await step("clinician → patient", () => card(page).getByRole("link", { name: "Patient sign in" }).click(), "/portal/login", "patient", "auth");
  await step("patient → home (Home link)", () => page.getByRole("link", { name: "Home", exact: true }).click(), "/", "home", "home");
  await step("home → clinician sign in", () => heroLink(page, "Sign in as a clinician").click(), "/login", "clinician", "auth");
  await step("clinician → home (browser back)", () => page.goBack().then(() => undefined), "/", "home", "home");
  await step("home → clinician (browser forward)", () => page.goForward().then(() => undefined), "/login", "clinician", "auth");
  await step("clinician → home (Home link)", () => page.getByRole("link", { name: "Home", exact: true }).click(), "/", "home", "home");
  // Leave home from the middle of the scroll story: the model starts from its scrolled pose.
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.7));
  await page.waitForTimeout(1500);
  await step(
    "home mid-scroll → patient sign in (nav)",
    () => page.locator("header nav").getByRole("link", { name: "Patient sign in" }).click(),
    "/portal/login",
    "patient",
    "auth",
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  gpu = await renderer(page);
  const count = await contexts(page) - 1; // minus the renderer probe just made for the report
  const summary = windows.map(summarize);
  results.sequence = { webglContexts: count, pageLoadCls: loadCls, transitions: summary, console: problems };

  expect(count, "WebGL contexts over the whole sequence").toBe(1);
  expect(problems, "console errors or warnings").toEqual([]);
  expect(loadCls, "layout shift on load").toBe(0);
  // CLS as browsers score it: shifts within 500 ms of the visitor's click are theirs and excluded.
  // The raw sums (with their sources) are in the metrics file.
  for (const s of summary) expect(s.clsExcludingInput, `layout shift in ${s.transition}`).toBe(0);
});

test("interruptions end in the right pose and page, with no stacked panels", async ({ page, isMobile }, info) => {
  const problems = await setup(page, info);
  await page.goto("/");
  await wake(page, isMobile);
  await stageReady(page);
  const out: Record<string, unknown> = {};

  // Rapid back and forward: 6 history moves in under 2 s.
  await heroLink(page, "Patient sign in").click();
  await expectRoute(page, "/portal/login", "patient");
  await card(page).getByRole("link", { name: "Clinician sign in" }).click();
  await expectRoute(page, "/login", "clinician");
  const t0 = Date.now();
  for (const move of ["back", "back", "forward", "back", "forward", "forward"] as const) {
    await page.evaluate((m) => (m === "back" ? history.back() : history.forward()), move);
    await page.waitForTimeout(280);
  }
  out.rapidHistoryMs = Date.now() - t0;
  await page.waitForTimeout(1800);
  await expectRoute(page, "/login", "clinician");
  await expectOnePanel(page, "auth");
  await expect(card(page)).toHaveAttribute("data-role", "clinician");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clinic sign in");

  // The other role mid-flight, then home before it lands.
  await card(page).getByRole("link", { name: "Patient sign in" }).click();
  await page.waitForTimeout(150);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.waitForTimeout(150);
  await page.locator("main").getByRole("link", { name: "Sign in as a clinician" }).first().click();
  await page.waitForTimeout(1800);
  await expectRoute(page, "/login", "clinician");
  await expectOnePanel(page, "auth");

  // Resizing during a transition (across the wide/narrow breakpoint on desktop).
  const size = page.viewportSize()!;
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expectRoute(page, "/", "home");
  await page.waitForTimeout(800);
  await heroLink(page, "Patient sign in").click();
  await page.setViewportSize({ width: Math.round(size.width * 0.7), height: size.height });
  await page.waitForTimeout(200);
  await page.setViewportSize(size);
  await page.waitForTimeout(1800);
  await expectRoute(page, "/portal/login", "patient");
  await expectOnePanel(page, "auth");

  out.webglContexts = await contexts(page);
  out.console = problems;
  results.interruptions = out;
  expect(out.webglContexts).toBe(1);
  expect(problems).toEqual([]);
});

test("a lost WebGL context falls back to the stills and comes back without a reload", async ({ page, isMobile }, info) => {
  const problems = await setup(page, info);
  await page.goto("/login");
  await wake(page, isMobile);
  await stageReady(page);
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>("[data-testid=entry-canvas] canvas")!.getContext("webgl2")!;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = gl.getExtension("WEBGL_lose_context")!;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose.loseContext();
  });
  await expect(page.locator("[data-stage]")).toHaveAttribute("data-canvas", "off");
  await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext());
  await stageReady(page);
  await card(page).getByRole("link", { name: "Patient sign in" }).click();
  await expectRoute(page, "/portal/login", "patient");
  results.contextLoss = { webglContexts: await contexts(page), console: problems, reloaded: false };
  expect(await contexts(page)).toBe(1);
  expect(problems).toEqual([]);
});

for (const variant of ["reduced-motion", "no-webgl"] as const) {
  test(`${variant}: every path works and looks intentional`, async ({ page, isMobile }, info) => {
    const problems = await setup(page, info, { webgl: variant !== "no-webgl" });
    if (variant === "reduced-motion") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await wake(page, isMobile);
    await page.waitForTimeout(isMobile ? 1500 : 3500);
    await expect(page.locator("[data-stage]")).toHaveAttribute("data-stage", "static");
    await expect(page.locator("[data-stage]")).toHaveAttribute("data-canvas", "off");
    const windows: Window[] = [];
    windows.push(await measure(page, "home → patient", () => heroLink(page, "Patient sign in").click()));
    await expectRoute(page, "/portal/login", "patient");
    await expect(page.locator('[data-stage] img[src*="entry-patient"]')).toBeVisible();
    windows.push(await measure(page, "patient → clinician", () => card(page).getByRole("link", { name: "Clinician sign in" }).click()));
    await expectRoute(page, "/login", "clinician");
    windows.push(await measure(page, "clinician → home", () => page.getByRole("link", { name: "Home", exact: true }).click()));
    await expectRoute(page, "/", "home");
    await expectOnePanel(page, "home");
    await filmstrip(page, info, `${variant}-home-to-patient`, () => heroLink(page, "Patient sign in").click(), 10);
    results[variant] = { webglContexts: await contexts(page), transitions: windows.map(summarize), console: problems };
    expect(await contexts(page)).toBe(0);
    // No WebGL: three.js reports the failed context once; that is the fallback working, not a fault.
    const expected = variant === "no-webgl" ? problems.filter((p) => !/WebGL context|WebGLRenderer|Error creating WebGL/i.test(p)) : problems;
    expect(expected).toEqual([]);
  });
}

test("filmstrips of every transition", async ({ page, isMobile }, info) => {
  await setup(page, info);
  await page.goto("/");
  await wake(page, isMobile);
  await stageReady(page);
  await page.waitForTimeout(1200);
  const files: string[] = [];
  files.push(await filmstrip(page, info, "01-home-to-patient", () => heroLink(page, "Patient sign in").click()));
  files.push(await filmstrip(page, info, "02-signin-to-create-account", () => page.getByRole("tab", { name: "Create account" }).click(), 10));
  files.push(await filmstrip(page, info, "03-create-account-to-signin", () => page.getByRole("tab", { name: "Sign in" }).click(), 10));
  files.push(await filmstrip(page, info, "04-patient-to-clinician", () => card(page).getByRole("link", { name: "Clinician sign in" }).click()));
  files.push(await filmstrip(page, info, "05-clinician-to-patient", () => card(page).getByRole("link", { name: "Patient sign in" }).click()));
  files.push(await filmstrip(page, info, "06-patient-to-home", () => page.getByRole("link", { name: "Home", exact: true }).click()));
  files.push(await filmstrip(page, info, "07-home-to-clinician", () => heroLink(page, "Sign in as a clinician").click()));
  files.push(await filmstrip(page, info, "08-back-to-home", () => page.goBack().then(() => undefined)));
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.7));
  await page.waitForTimeout(1500);
  files.push(await filmstrip(page, info, "09-mid-scroll-to-patient", () => page.locator("header nav").getByRole("link", { name: "Patient sign in" }).click()));
  await page.goto("/portal/signup");
  await page.waitForTimeout(100);
  files.push(await filmstrip(page, info, "10-deep-link-first-paint", () => stageReady(page).then(() => page.waitForTimeout(400)), 12));
  results.filmstrips = files.map((f) => path.relative(QA_DIR, f));
});
