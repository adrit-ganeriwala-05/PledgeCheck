// Tracks live test-model WebGL canvases so the patient flow can wait until every one has been
// unmounted and its context released before it asks for the camera (the camera needs the GPU).
const live = new Set<HTMLCanvasElement>();

export function trackCanvas(canvas: HTMLCanvasElement) {
  live.add(canvas);
  canvas.addEventListener("webglcontextlost", () => live.delete(canvas), { once: true });
}

/** Resolves once no test-model canvas holds a WebGL context (or after the timeout). */
export async function testModelsReleased(timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (live.size > 0 && Date.now() - start < timeoutMs) {
    // A canvas that left the page without a context-lost event is no longer rendering either.
    for (const canvas of live) if (!canvas.isConnected && Date.now() - start > 200) live.delete(canvas);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

export function liveTestModelCount(): number {
  return live.size;
}
