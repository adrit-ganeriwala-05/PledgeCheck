// Shared setup: jest-dom matchers everywhere; DOM cleanup only in jsdom test files
// (those start with `// @vitest-environment jsdom`).
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
