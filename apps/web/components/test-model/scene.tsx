"use client";

// The live canvas for <TestModel />. Loaded with next/dynamic, so three.js never lands in a
// route's initial bundle.
import { AdaptiveDpr, PerformanceMonitor, PresentationControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { Effects } from "./effects";
import { PregnancyTest, type Quality } from "./pregnancy-test";
import { trackCanvas } from "./release";
import { Studio } from "./studio";

export type View = "hero" | "instruction";

export type SceneProps = {
  tier: Quality;
  onDecline?: () => void;
  view: View;
  lineProgress: number | "develop";
  showCode: boolean;
  code: string | null;
  interactive: boolean;
  autoRotate: boolean;
  draggable: boolean;
  /** False while scrolled out of view: rendering stops. */
  active: boolean;
  onReady: () => void;
};

// Long lens, low field of view: like a product photographer's 70-85 mm, no wide-angle distortion.
export const VIEWS: Record<View, { camera: [number, number, number]; fov: number; yaw: number; pitch: number; offset: [number, number, number]; focus: number }> = {
  hero: { camera: [0, 10, 29.5], fov: 20, yaw: -0.42, pitch: 0, offset: [0.4, 0.14, 0.6], focus: 31 },
  // Looking down at the top face, so the window and the code area read clearly.
  instruction: { camera: [0, 34, 14], fov: 22, yaw: 0, pitch: 0, offset: [0.3, 0.14, 0], focus: 36 },
};

const REST_Y = 0.15;

const DPR: Record<Quality, [number, number] | number> = { high: [1, 2], medium: [1, 1.5], low: 1 };

export function Scene(props: SceneProps) {
  const { tier, view, active, autoRotate, interactive, draggable, lineProgress } = props;
  const animating = autoRotate || interactive || draggable || lineProgress === "develop";
  const v = VIEWS[view];
  return (
    <Canvas
      dpr={DPR[tier]}
      frameloop={active ? (animating ? "always" : "demand") : "never"}
      camera={{ position: v.camera, fov: v.fov, near: 1, far: 200 }}
      gl={{ antialias: true, powerPreference: tier === "low" ? "low-power" : "high-performance" }}
      onCreated={({ gl }) => trackCanvas(gl.domElement)}
      aria-hidden
    >
      <Renderer tier={tier} />
      <PerformanceMonitor onDecline={props.onDecline} flipflops={2} />
      <AdaptiveDpr pixelated={false} />
      <Studio quality={tier} shadowFrames={animating ? Infinity : 2} />
      <Rig {...props} />
      {tier === "high" ? <Effects focusDistance={v.focus} /> : null}
      <ReadySignal onReady={props.onReady} />
    </Canvas>
  );
}

/** AgX tone mapping, sRGB output. With post-processing, tone mapping moves to the last effect. */
function Renderer({ tier }: { tier: Quality }) {
  const toneMapping = tier === "high" ? THREE.NoToneMapping : THREE.AgXToneMapping;
  useFrame(({ gl }) => {
    if (gl.toneMapping === toneMapping) return;
    gl.toneMapping = toneMapping;
    gl.toneMappingExposure = 1.2;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  });
  return null;
}

function Rig({ view, lineProgress, showCode, code, interactive, autoRotate, draggable, tier }: SceneProps) {
  const v = VIEWS[view];
  const group = useRef<THREE.Group>(null);
  const [develop, setDevelop] = useState(lineProgress === "develop" ? 0 : null);

  // The one orchestrated moment on load: after a beat, the control line develops.
  useEffect(() => {
    if (lineProgress !== "develop") return;
    const id = setTimeout(() => setDevelop(1), 700);
    return () => clearTimeout(id);
  }, [lineProgress]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const sway = autoRotate ? Math.sin(t * 0.22) * 0.3 : 0;
    const tiltY = interactive ? state.pointer.x * 0.2 : 0;
    const tiltX = interactive ? -state.pointer.y * 0.07 : 0;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, v.yaw + sway + tiltY, 2.2, dt);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, v.pitch + tiltX, 2.2, dt);
  });

  const test = {
    quality: tier,
    lineProgress: lineProgress === "develop" ? (develop ?? 1) : lineProgress,
    showCode,
    code,
    // The cap's underside sits a little below the body; lift so the whole test rests on y = 0.
    "position-y": REST_Y,
  };
  const model = (
    <group ref={group} position={[v.offset[0], 0, v.offset[2]]} rotation={[v.pitch, v.yaw, 0]}>
      <PregnancyTest {...test} />
      {/* The reflection in the black acrylic floor (see Studio). Skipped on the low tier. */}
      {tier !== "low" ? (
        <group scale={[1, -1, 1]}>
          <PregnancyTest {...test} />
        </group>
      ) : null}
    </group>
  );

  if (!draggable) return model;
  return (
    <PresentationControls
      global={false}
      cursor
      snap
      speed={1.4}
      polar={[-0.35, 0.5]}
      azimuth={[-Math.PI / 2, Math.PI / 2]}
      damping={0.35}
    >
      {model}
    </PresentationControls>
  );
}

/** Tells the wrapper when real frames are on screen, so the poster can hand over without a pop. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    // In demand mode, ask for the few frames the handover needs.
    const id = setInterval(() => (done.current ? clearInterval(id) : invalidate()), 50);
    return () => clearInterval(id);
  }, [invalidate]);
  useFrame(() => {
    if (done.current) return;
    frames.current += 1;
    if (frames.current >= 4) {
      done.current = true;
      onReady();
    }
  });
  return null;
}
