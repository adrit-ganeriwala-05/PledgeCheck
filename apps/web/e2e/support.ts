// Shared helpers for the entry-page e2e suite: in-page instrumentation, console capture, and
// the metrics/filmstrip writers.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { expect, type Page, type TestInfo } from "@playwright/test";

// Playwright loads specs as CommonJS, so __dirname (not import.meta) is what exists here.
export const QA_DIR = path.join(__dirname, "..", "..", "..", "notes", "transition-qa");

/** Installed before any page script: counts WebGL contexts and records frames, long tasks and shifts. */
export function instrument() {
  type Shift = { t: number; value: number; input: boolean; sources: string[] };
  const qa = {
    contexts: 0,
    frames: [] as number[],
    recording: false,
    longtasks: [] as { t: number; d: number }[],
    shifts: [] as Shift[],
  };
  (window as unknown as { __qa: typeof qa }).__qa = qa;
  const seen = new WeakSet<HTMLCanvasElement>();
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const context = (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    if (context && /webgl/.test(type) && !seen.has(this)) {
      seen.add(this);
      qa.contexts += 1;
    }
    return context;
  } as typeof original;
  let last: number | undefined;
  const tick = (t: number) => {
    if (qa.recording && last !== undefined) qa.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) qa.longtasks.push({ t: e.startTime, d: e.duration });
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      type Source = { node?: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly };
      for (const e of list.getEntries() as unknown as { startTime: number; value: number; hadRecentInput: boolean; sources?: Source[] }[]) {
        const sources = (e.sources ?? []).map((src) => {
          const el = src.node instanceof Element ? src.node : src.node?.parentElement;
          const name = el ? `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"` : "?";
          return `${name} y ${Math.round(src.previousRect.y)}→${Math.round(src.currentRect.y)} h ${Math.round(src.previousRect.height)}→${Math.round(src.currentRect.height)}`;
        });
        qa.shifts.push({ t: e.startTime, value: e.value, input: e.hadRecentInput, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // Observers unsupported: the metrics say so (empty arrays).
  }
}

/** Makes WebGL unavailable, as on a blocklisted GPU. */
export function disableWebGL() {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (/webgl/i.test(type)) return null;
    return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
  } as typeof original;
}

// Known, third-party, not ours: @react-three/fiber 9.8 constructs THREE.Clock, which three 0.186 deprecates.
// Software GL only (SwiftShader lacks the extension): three falls back to ordinary compiling.
const ALLOWED = [/THREE\.Clock: This module has been deprecated/, /KHR_parallel_shader_compile extension not supported/];

export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (ALLOWED.some((re) => re.test(m.text()))) return;
    problems.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

export async function stageReady(page: Page) {
  await page.waitForSelector('[data-canvas="shown"]', { timeout: 30_000 });
}

export async function expectRoute(page: Page, pathname: string, route: string) {
  await expect(page).toHaveURL((url) => url.pathname === pathname);
  await expect(page.locator("[data-stage]")).toHaveAttribute("data-route", route);
}

/** Exactly one panel in the content layer (no stacked or duplicated panels). */
export async function expectOnePanel(page: Page, panel: "home" | "auth") {
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.locator(`[data-panel="${panel}"]`)).toHaveCount(1);
}

export type Window = { name: string; frames: number[]; longtasks: { t: number; d: number }[]; shifts: { t: number; value: number; input: boolean; sources: string[] }[] };

/** Records frames, long tasks and layout shifts while `run` executes and `settleMs` after. */
export async function measure(page: Page, name: string, run: () => Promise<void>, settleMs = 1500): Promise<Window> {
  const start = await page.evaluate(() => {
    const qa = (window as unknown as { __qa: { frames: number[]; recording: boolean } }).__qa;
    qa.frames = [];
    qa.recording = true;
    return performance.now();
  });
  await run();
  await page.waitForTimeout(settleMs);
  return page.evaluate(
    ({ name, start }) => {
      const qa = (window as unknown as { __qa: { frames: number[]; recording: boolean; longtasks: { t: number; d: number }[]; shifts: { t: number; value: number; input: boolean; sources: string[] }[] } }).__qa;
      qa.recording = false;
      return { name, frames: qa.frames.slice(), longtasks: qa.longtasks.filter((l) => l.t >= start), shifts: qa.shifts.filter((s) => s.t >= start) };
    },
    { name, start },
  );
}

export function summarize(w: Window) {
  const sorted = [...w.frames].sort((a, b) => a - b);
  const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
  return {
    transition: w.name,
    frames: sorted.length,
    medianMs: +q(0.5).toFixed(1),
    p95Ms: +q(0.95).toFixed(1),
    over33ms: sorted.filter((d) => d > 33.4).length,
    longTasksOver50ms: w.longtasks.filter((l) => l.d > 50).map((l) => Math.round(l.d)),
    cls: +w.shifts.reduce((s, x) => s + x.value, 0).toFixed(4),
    clsExcludingInput: +w.shifts.filter((x) => !x.input).reduce((s, x) => s + x.value, 0).toFixed(4),
    shiftSources: [...new Set(w.shifts.flatMap((x) => x.sources))].slice(0, 6),
  };
}

export async function renderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    // Probe only for the report, after the runs: this makes a second context on purpose.
    const gl = c.getContext("webgl");
    if (!gl) return "none";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return name;
  });
}

export function writeJson(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** Screenshots every ~100 ms while `run` plays, composed into one contact sheet. */
export async function filmstrip(page: Page, info: TestInfo, name: string, run: () => Promise<void>, count = 15) {
  const shots: { buf: Buffer; t: number }[] = [];
  const t0 = Date.now();
  const running = run();
  for (let i = 0; i < count; i++) {
    shots.push({ buf: await page.screenshot({ scale: "css" }), t: Date.now() - t0 });
    const wait = (i + 1) * 100 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
  }
  await running;
  const sharp = createRequire(require.resolve("next/package.json"))("sharp");
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const w = Math.round(vp.width / (vp.width > 800 ? 4 : 2));
  const h = Math.round((vp.height * w) / vp.width);
  const cols = vp.width > 800 ? 5 : 8;
  const label = 22;
  const tiles = await Promise.all(
    shots.map(async (s) => {
      const img = await sharp(s.buf).resize(w, h).png().toBuffer();
      const text = Buffer.from(`<svg width="${w}" height="${label}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="monospace" font-size="13" fill="#ddd">${s.t} ms</text></svg>`);
      return sharp({ create: { width: w, height: h + label, channels: 3, background: "#111" } })
        .composite([{ input: text, top: 0, left: 0 }, { input: img, top: label, left: 0 }])
        .png()
        .toBuffer();
    }),
  );
  const rows = Math.ceil(tiles.length / cols);
  const file = path.join(QA_DIR, "filmstrips", `${info.project.name.replace("motion-", "")}-${name}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w * cols, height: (h + label) * rows, channels: 3, background: "#222" } })
    .composite(tiles.map((t: Buffer, i: number) => ({ input: t, left: (i % cols) * w, top: Math.floor(i / cols) * (h + label) })))
    .png()
    .toFile(file);
  return file;
}
