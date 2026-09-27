// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { liveTestModelCount, testModelsReleased, trackCanvas } from "./release";
import { TestModel } from "./test-model";

vi.mock("next/dynamic", () => ({
  default: () =>
    function SceneStub() {
      return <canvas data-testid="live-scene" />;
    },
}));

function mockMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("TestModel fallbacks", () => {
  it("shows only the poster when WebGL is unavailable", () => {
    mockMedia(false);
    // jsdom has no WebGL: getContext returns null.
    render(<TestModel alt="A pregnancy test" />);
    expect(screen.getByRole("img", { name: "A pregnancy test" })).toBeInTheDocument();
    expect(screen.queryByTestId("live-scene")).not.toBeInTheDocument();
  });

  it("shows only the poster when reduced motion is set, even with WebGL", () => {
    mockMedia(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getExtension: () => null } as never);
    render(<TestModel alt="A pregnancy test" />);
    expect(screen.queryByTestId("live-scene")).not.toBeInTheDocument();
  });

  it("mounts the live scene when WebGL is available and motion is allowed", () => {
    mockMedia(false);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getExtension: () => null } as never);
    render(<TestModel alt="A pregnancy test" />);
    expect(screen.getByTestId("live-scene")).toBeInTheDocument();
  });
});

describe("testModelsReleased", () => {
  it("waits until each tracked canvas has lost its context", async () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    trackCanvas(canvas);
    expect(liveTestModelCount()).toBe(1);
    let released = false;
    const wait = testModelsReleased(2000).then(() => (released = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(released).toBe(false);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    await wait;
    expect(released).toBe(true);
    expect(liveTestModelCount()).toBe(0);
    canvas.remove();
  });
});
