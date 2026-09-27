import { defineConfig, devices } from "@playwright/test";

// End-to-end checks for the entry pages (home, patient and clinician sign-in).
//
//   flows   functional tests against the dev server with every endpoint mocked (auth included)
//   motion  smoothness and glitch measurements against a production build
//
// Both servers are started if they aren't running. Chromium gets the machine's GPU (ANGLE/Metal on a
// Mac) unless E2E_SOFTWARE_GL=1: headless Chromium otherwise renders WebGL in software (SwiftShader),
// which says nothing about real frame rates. The GPU mode is written into every metrics file.
const DEV = process.env.E2E_DEV_URL ?? "http://localhost:3000";
const PROD = process.env.E2E_PROD_URL ?? "http://localhost:3200";
const gpuArgs = process.env.E2E_SOFTWARE_GL === "1" ? [] : ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"];

const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const phone = { ...devices["iPhone 14"], browserName: "chromium" as const, viewport: { width: 390, height: 844 } };

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../notes/transition-qa/test-results",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    launchOptions: { args: gpuArgs },
    video: process.env.E2E_VIDEO === "1" ? "on" : "off",
    trace: "off",
  },
  projects: [
    { name: "flows-desktop", testMatch: /flows\.spec\.ts/, use: { ...desktop, baseURL: DEV } },
    { name: "flows-mobile", testMatch: /flows\.spec\.ts/, use: { ...phone, baseURL: DEV } },
    { name: "motion-desktop", testMatch: /motion\.spec\.ts/, use: { ...desktop, baseURL: PROD } },
    { name: "motion-mobile", testMatch: /motion\.spec\.ts/, use: { ...phone, baseURL: PROD } },
  ],
  webServer: [
    {
      command: "NEXT_PUBLIC_API_MOCKS=all next dev -p 3000",
      url: `${DEV}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "next build && next start -p 3200",
      url: `${PROD}/login`,
      reuseExistingServer: true,
      timeout: 600_000,
    },
  ],
});
