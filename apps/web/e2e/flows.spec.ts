// Functional checks for the entry pages, against the dev server with every endpoint mocked
// (NEXT_PUBLIC_API_MOCKS=all). Mock fixtures: lib/api/mocks/index.ts.
import { expect, test, type Page } from "@playwright/test";

import { expectOnePanel, expectRoute, watchConsole } from "./support";

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = watchConsole(page);
});
test.afterEach(() => {
  expect(problems, "console errors or warnings").toEqual([]);
});

const hero = (page: Page, name: string) => page.locator("main").getByRole("link", { name }).first();
const card = (page: Page) => page.getByTestId("auth-card");
const fill = async (page: Page, label: string | RegExp, value: string) => page.getByLabel(label, { exact: typeof label === "string" }).fill(value);

/** Marks the card's DOM node, to prove later that the same node is still there (it never remounted). */
async function tagCard(page: Page) {
  await card(page).evaluate((el) => ((el as HTMLElement & { __tag?: number }).__tag = 42));
}
async function cardKept(page: Page) {
  return card(page).evaluate((el) => (el as HTMLElement & { __tag?: number }).__tag === 42);
}

test.describe("routes", () => {
  for (const [path, route, heading] of [
    ["/", "home", "Take your iPLEDGE test at home."],
    ["/portal/login", "patient", "Welcome back"],
    ["/portal/signup", "patient-signup", "Create your account"],
    ["/login", "clinician", "Clinic sign in"],
  ] as const) {
    test(`deep link and refresh on ${path} land straight in its pose`, async ({ page }) => {
      await page.goto(path);
      await expectRoute(page, path, route);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await page.reload();
      await expectRoute(page, path, route);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }

  test("URLs outside the group still resolve", async ({ page }) => {
    for (const path of ["/portal", "/login/no-access"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });
});

test.describe("home to sign in and back", () => {
  test("patient: hero button, back and forward", async ({ page }) => {
    await page.goto("/");
    await hero(page, "Patient sign in").click();
    await expectRoute(page, "/portal/login", "patient");
    await expect(page.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
    await expectOnePanel(page, "auth");
    await page.goBack();
    await expectRoute(page, "/", "home");
    await expect(page.getByRole("heading", { level: 1, name: "Take your iPLEDGE test at home." })).toBeVisible();
    await expectOnePanel(page, "home");
    await page.goForward();
    await expectRoute(page, "/portal/login", "patient");
    await expectOnePanel(page, "auth");
  });

  test("clinician: hero button, then the Home link", async ({ page }) => {
    await page.goto("/");
    await hero(page, "Sign in as a clinician").click();
    await expectRoute(page, "/login", "clinician");
    await expect(card(page)).toHaveAttribute("data-role", "clinician");
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await expectRoute(page, "/", "home");
    await expectOnePanel(page, "home");
  });

  test("create account from the bottom of home: scroll resets to the top", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Create a patient account" });
    await link.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await link.click();
    await expectRoute(page, "/portal/signup", "patient-signup");
    await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("a double click on a sign-in button navigates once", async ({ page }) => {
    await page.goto("/");
    const before = await page.evaluate(() => history.length);
    await hero(page, "Patient sign in").dblclick();
    await expectRoute(page, "/portal/login", "patient");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expectRoute(page, "/", "home");
  });
});

test.describe("inside the card", () => {
  test("patient and clinician swap in the same card, and back", async ({ page }) => {
    await page.goto("/portal/login");
    await tagCard(page);
    await card(page).getByRole("link", { name: "Clinician sign in" }).click();
    await expectRoute(page, "/login", "clinician");
    await expect(page.getByRole("heading", { name: "Clinic sign in" })).toBeVisible();
    expect(await cardKept(page)).toBe(true);
    await card(page).getByRole("link", { name: "Patient sign in" }).click();
    await expectRoute(page, "/portal/login", "patient");
    expect(await cardKept(page)).toBe(true);
    await page.goBack();
    await expectRoute(page, "/login", "clinician");
    expect(await cardKept(page)).toBe(true);
    await expectOnePanel(page, "auth");
  });

  test("tabs switch without a reload; the URL follows and Back switches back", async ({ page }) => {
    await page.goto("/portal/login?next=%2Fportal");
    await tagCard(page);
    await page.getByRole("tab", { name: "Create account" }).click();
    await expectRoute(page, "/portal/signup", "patient-signup");
    expect(new URL(page.url()).search).toBe("?next=%2Fportal");
    await expect(page.getByLabel("Enrollment code")).toBeVisible();
    await page.goBack();
    await expectRoute(page, "/portal/login", "patient");
    await expect(page.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expectRoute(page, "/portal/signup", "patient-signup");
    expect(await cardKept(page)).toBe(true);
  });

  test("tabs work from the keyboard", async ({ page }) => {
    await page.goto("/portal/login");
    await page.getByRole("tab", { name: "Sign in" }).focus();
    await page.keyboard.press("ArrowRight");
    await expectRoute(page, "/portal/signup", "patient-signup");
    await expect(page.getByRole("tab", { name: "Create account" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expectRoute(page, "/portal/login", "patient");
    await expect(page.getByRole("tab", { name: "Sign in" })).toBeFocused();
  });
});

test.describe("patient sign in", () => {
  test("signs in and opens the portal", async ({ page }) => {
    await page.goto("/portal/login");
    await fill(page, "Email", "pat@example.test");
    await fill(page, "Password", "anything");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 15_000 });
  });

  test("Enter submits and a same-origin next path is honored", async ({ page }) => {
    await page.goto("/portal/login?next=%2Fportal%3Ffrom%3Demail");
    await fill(page, "Email", "pat@example.test");
    await fill(page, "Password", "anything");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL((url) => url.pathname === "/portal" && url.search === "?from=email", { timeout: 15_000 });
  });

  for (const next of ["https%3A%2F%2Fevil.test%2F", "%2F%2Fevil.test", "%2F%5Cevil.test"]) {
    test(`rejects next=${decodeURIComponent(next)}`, async ({ page }) => {
      await page.goto(`/portal/login?next=${next}`);
      await fill(page, "Email", "pat@example.test");
      await fill(page, "Password", "anything");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL((url) => url.origin === new URL(page.url()).origin && url.pathname === "/portal", { timeout: 15_000 });
    });
  }

  test("wrong password: one plain message, values kept", async ({ page }) => {
    await page.goto("/portal/login");
    await fill(page, "Email", "pat@example.test");
    await fill(page, "Password", "wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(card(page).getByRole("alert")).toHaveText("Email or password is incorrect.");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("pat@example.test");
  });

  test("network failure: says so, keeps the values, retry works", async ({ page }) => {
    await page.goto("/portal/login");
    await fill(page, "Email", "pat@offline.test");
    await fill(page, "Password", "secret");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(card(page).getByRole("alert")).toContainText("Could not reach PledgeCheck");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("secret");
    await fill(page, "Email", "pat@example.test");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 15_000 });
  });

  test("validates on blur, not while typing", async ({ page }) => {
    await page.goto("/portal/login");
    const email = page.getByLabel("Email", { exact: true });
    await email.fill("not-an-email");
    await expect(card(page).getByRole("alert")).toHaveCount(0);
    await email.blur();
    await expect(card(page).getByRole("alert")).toHaveText("Enter an email address like name@example.com.");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await email.fill("pat@example.test");
    await expect(card(page).getByRole("alert")).toHaveCount(0);
  });

  test("show and hide the password", async ({ page }) => {
    await page.goto("/portal/login");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "true");
  });

  test("tab order is logical", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard order is checked on desktop");
    await page.goto("/portal/login");
    await page.getByRole("tab", { name: "Sign in" }).focus();
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return el.matches("button[type=submit]") ? "submit" : el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.textContent?.trim() ?? el.tagName;
      }));
    }
    expect(order).toEqual(["email", "password", "Show password", "Forgot password?", "submit", "Clinician sign in"]);
  });

  test("forgot password never says whether the account exists", async ({ page }) => {
    await page.goto("/portal/login");
    await fill(page, "Email", "someone@example.test");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("someone@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists for that email, we've sent a reset link.");
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
});

test.describe("create account", () => {
  async function submit(page: Page, email: string, password: string, code: string) {
    await page.goto("/portal/signup");
    await fill(page, "Email", email);
    await fill(page, "Password", password);
    await fill(page, "Enrollment code", code);
    await page.getByRole("button", { name: "Create account" }).click();
  }

  test("creates the account, links it and opens the portal", async ({ page }) => {
    await submit(page, "new@example.test", "password123", "K4M9-TQ2P");
    await expect(page).toHaveURL(/\/portal$/, { timeout: 15_000 });
  });

  test("existing email: points to sign in", async ({ page }) => {
    await submit(page, "someone@taken.test", "password123", "K4M9-TQ2P");
    const alert = card(page).getByRole("alert");
    await expect(alert).toContainText("An account with this email already exists.");
    await alert.getByRole("link", { name: "Sign in" }).click();
    await expectRoute(page, "/portal/login", "patient");
  });

  test("short password and malformed code are caught before any request", async ({ page }) => {
    await submit(page, "new@example.test", "short", "K4M9");
    await expect(page.getByText("Choose a stronger password: at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Enrollment codes are 8 letters and numbers, like K4M9-TQ2P.")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  });

  test("invalid code from the server, then a retry links the account", async ({ page }) => {
    await submit(page, "new@example.test", "password123", "ABCD-12$4");
    await expect(card(page).getByRole("alert")).toHaveText("That code isn't valid. Check it with your clinic.");
    await fill(page, "Enrollment code", "K4M9-TQ2P");
    await page.getByRole("button", { name: "Link my account" }).click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 15_000 });
  });

  test("expired code", async ({ page }) => {
    await submit(page, "new@example.test", "password123", "EXP1-2345");
    await expect(card(page).getByRole("alert")).toHaveText("That code has expired. Ask your clinic for a new one.");
  });

  test("network failure", async ({ page }) => {
    await submit(page, "new@offline.test", "password123", "K4M9-TQ2P");
    await expect(card(page).getByRole("alert")).toContainText("Could not reach the sign-in service");
    await expect(page.getByLabel("Enrollment code")).toHaveValue("K4M9-TQ2P");
  });

  test("email confirmation on: check-your-email state in the card", async ({ page }) => {
    await submit(page, "confirm@example.test", "password123", "K4M9-TQ2P");
    await expect(page.getByRole("heading", { name: "Check your email to confirm your account" })).toBeVisible();
    await page.getByRole("link", { name: "Go to sign in" }).click();
    await expectRoute(page, "/portal/login", "patient");
  });
});

test.describe("clinician sign in", () => {
  const attempts = (page: Page) =>
    page.evaluate(() => (JSON.parse(localStorage.getItem("pledgecheck.mock-db.v1") ?? "{}") as { signInAttempts?: number }).signInAttempts ?? 0);

  test("a double click on submit sends one request; bad credentials get one message", async ({ page }) => {
    await page.goto("/login");
    await fill(page, "Email", "staff@example.test");
    await fill(page, "Password", "wrong");
    const before = await attempts(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).dblclick();
    await expect(page.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    await expect(card(page).getByRole("alert")).toHaveText("Email or password is incorrect.");
    expect((await attempts(page)) - before).toBe(1);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  });

  test("network failure", async ({ page }) => {
    await page.goto("/login");
    await fill(page, "Email", "staff@offline.test");
    await fill(page, "Password", "secret");
    await page.keyboard.press("Enter");
    await expect(card(page).getByRole("alert")).toContainText("Could not reach the sign-in service");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("staff@offline.test");
  });

  test("success fades the card and the model out, then leaves the group", async ({ page }) => {
    // Role routing needs a real Supabase session; offline it answers as for a signed-in non-clinician.
    await page.route("**/login/continue**", (route) => route.fulfill({ status: 303, headers: { location: "/login/no-access" } }));
    await page.goto("/login");
    await fill(page, "Email", "staff@example.test");
    await fill(page, "Password", "secret");
    // The page stays client-side, so a frame sampler survives the navigation.
    await page.evaluate(() => {
      const w = window as unknown as { __fade: { content: number; stage: number; at: string }[] };
      w.__fade = [];
      const sample = () => {
        const content = document.querySelector(".entry-content");
        const stage = document.querySelector("[data-stage]");
        if (content && stage) w.__fade.push({ content: +getComputedStyle(content).opacity, stage: +getComputedStyle(stage).opacity, at: location.pathname });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login\/no-access$/, { timeout: 15_000 });
    const fade = await page.evaluate(() => (window as unknown as { __fade: { content: number; stage: number; at: string }[] }).__fade);
    const last = fade.filter((f) => f.at === "/login").at(-1);
    // By the time the entry layout goes, card and model had both faded out together.
    expect(last?.content).toBeLessThan(0.05);
    expect(last?.stage).toBeLessThan(0.05);
  });
});
