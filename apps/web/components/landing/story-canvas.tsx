"use client";

// The landing page's scroll story, one idea told in three moves:
//   hero       the control line develops on the test (on load)
//   chapter 1  the cap lifts and the test turns to face the viewer
//   chapter 2  the code is written on the test and a camera frame closes around it
//   chapter 3  the frame becomes a glass block, which links into a short chain: the audit chain
// Scroll progress arrives as a Motion value and is read (and damped) inside useFrame, so
// scrolling never re-renders React.
import { AdaptiveDpr, PerformanceMonitor, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { MotionValue } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { Effects } from "@/components/test-model/effects";
import { PregnancyTest, type Quality } from "@/components/test-model/pregnancy-test";
import { trackCanvas } from "@/components/test-model/release";
import { ReadySignal, Renderer, REST_Y } from "@/components/test-model/scene";
import { Studio } from "@/components/test-model/studio";

export type Layout = "wide" | "narrow";

type V3 = [number, number, number];
type Key = { t: number; cam: V3; look: V3 };

type LayoutConfig = {
  /** Vertical field of view at the design aspect; the horizontal field of view is kept constant. */
  fov: number;
  aspect: number;
  heroPos: V3;
  heroYaw: number;
  facePos: V3;
  faceYaw: number;
  faceTilt: number;
  keys: Key[];
  focus: number;
};

// Camera keyframes along the scroll, per layout. Wide: copy on the left, the test on the right.
// Narrow (phones): copy at the bottom, the test in the upper part of the frame.
export const LAYOUTS: Record<Layout, LayoutConfig> = {
  wide: {
    fov: 20,
    aspect: 1.8,
    heroPos: [5.2, REST_Y, 0.6],
    heroYaw: -0.42,
    facePos: [5, 3.4, 0],
    faceYaw: -0.12,
    faceTilt: 0.95,
    focus: 41,
    keys: [
      { t: 0, cam: [0, 9.5, 44], look: [-1.4, 1, 0] },
      { t: 0.25, cam: [0, 7, 49], look: [-2.6, 3.2, 0] },
      { t: 0.5, cam: [0.4, 6.8, 53], look: [-3.2, 3.3, 0] },
      { t: 0.7, cam: [0, 7, 41], look: [-1.2, 3.3, 0] },
      { t: 1, cam: [-4, 13, 62], look: [-10.5, 2.6, 0] },
    ],
  },
  narrow: {
    fov: 30,
    aspect: 0.462,
    heroPos: [0.3, REST_Y, 0],
    heroYaw: -1.0,
    facePos: [0.3, 3.4, 0],
    faceYaw: -0.8,
    faceTilt: 0.95,
    focus: 52,
    keys: [
      { t: 0, cam: [0, 12, 52], look: [0, -4.2, 0] },
      { t: 0.25, cam: [0, 9, 58], look: [0, 0.4, 0] },
      { t: 0.5, cam: [0, 9, 60], look: [0, 0.6, 0] },
      { t: 0.7, cam: [0, 9, 52], look: [0, -1.2, 0] },
      // Pulled far back so the whole chain fits a portrait screen.
      { t: 1, cam: [-7.1, 12, 92], look: [-7.1, -8, 0] },
    ],
  },
};

const BLOCK = 5.4;
const TEST_LENGTH = 12.6;
const CHAIN_GAP = 7.4;
const PAST_BLOCKS = 2;
const DEMO_CODE = "K7R4";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
// Weighted ease-in-out: slow start, slow settle, no overshoot.
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp3 = (out: THREE.Vector3, a: V3, b: V3, k: number) =>
  out.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);

function cameraAt(keys: Key[], t: number, cam: THREE.Vector3, look: THREE.Vector3) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const k = ease(seg(t, a.t, b.t));
  lerp3(cam, a.cam, b.cam, k);
  lerp3(look, a.look, b.look, k);
}

export type StoryCanvasProps = {
  progress: MotionValue<number>;
  layout: Layout;
  tier: Quality;
  active: boolean;
  onReady: () => void;
  onDecline?: () => void;
  /** Play the control line developing after load (off only to render the poster still). */
  develop?: boolean;
};

export function StoryCanvas({ progress, layout, tier, active, onReady, onDecline, develop = true }: StoryCanvasProps) {
  const L = LAYOUTS[layout];
  // Desktop keeps a continuous loop for the idle sway and pointer tilt. Phones render on demand:
  // only while the scroll position or an animation is still settling.
  const continuous = layout === "wide";
  return (
    <Canvas
      dpr={tier === "high" ? [1, 2] : [1, 1.5]}
      frameloop={active ? (continuous ? "always" : "demand") : "never"}
      camera={{ position: L.keys[0].cam, fov: L.fov, near: 1, far: 300 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => trackCanvas(gl.domElement)}
      aria-hidden
    >
      <Renderer tier={tier} />
      <PerformanceMonitor onDecline={onDecline} flipflops={2} />
      <AdaptiveDpr pixelated={false} />
      <Studio quality={tier} />
      <Lens layout={layout} />
      <Story progress={progress} layout={layout} tier={tier} develop={develop} idle={continuous} />
      {tier === "high" ? <Effects focusDistance={L.focus} focusRange={18} /> : null}
      <ReadySignal onReady={onReady} />
    </Canvas>
  );
}

/**
 * Keep the horizontal field of view constant, so the scene frames the same on 16:10 and 16:9
 * (and on any phone). The posters are taller than any viewport and are cropped top and bottom
 * by object-cover, which matches this camera exactly.
 */
function Lens({ layout }: { layout: Layout }) {
  const L = LAYOUTS[layout];
  const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(L.fov / 2)) * L.aspect);
  useFrame(({ camera, size }) => {
    const cam = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfH) / (size.width / size.height)));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

function Story({
  progress,
  layout,
  tier,
  develop,
  idle,
}: {
  progress: MotionValue<number>;
  layout: Layout;
  tier: Quality;
  develop: boolean;
  /** Idle sway and pointer tilt (desktop only). */
  idle: boolean;
}) {
  const L = LAYOUTS[layout];
  const t = useRef(progress.get());
  const developed = useRef(0);
  const rig = useRef<THREE.Group>(null);
  const mirror = useRef<THREE.Group>(null);
  const frame = useRef<THREE.Group>(null);
  const block = useRef<THREE.Group>(null);
  const chain = useRef<THREE.Group>(null);
  const cam = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);

  // The one orchestrated moment on load: after a beat, the control line develops.
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!develop) return;
    const id = setTimeout(() => {
      developed.current = 1;
      invalidate();
    }, 900);
    return () => clearTimeout(id);
  }, [develop, invalidate]);

  // On-demand rendering: every scroll change asks for a frame; useFrame keeps asking until settled.
  useEffect(() => progress.on("change", () => invalidate()), [progress, invalidate]);

  const driven = useMemo(
    () => ({
      line: { get: () => developed.current },
      // Off in chapter 1, back on before the test goes into its block.
      cap: { get: () => ease(seg(t.current, 0.05, 0.22)) * (1 - ease(seg(t.current, 0.47, 0.6))) },
      code: { get: () => seg(t.current, 0.3, 0.42) },
    }),
    [],
  );

  const blockPos = L.facePos;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const target = progress.get();
    t.current = THREE.MathUtils.damp(t.current, target, 5, dt);
    if (Math.abs(t.current - target) > 0.0005) state.invalidate();
    const p = t.current;
    const face = ease(seg(p, 0.04, 0.25));
    const close = ease(seg(p, 0.3, 0.47));
    const glass = ease(seg(p, 0.52, 0.7));
    const link = seg(p, 0.72, 0.96);

    // The test: rests, then rises and turns to face the viewer, then shrinks into its block.
    const r = rig.current;
    if (r) {
      const sway = idle ? Math.sin(state.clock.elapsedTime * 0.22) * 0.18 * (1 - face) : 0;
      const tilt = idle ? state.pointer.x * 0.12 * (1 - face) : 0;
      lerp3(r.position, L.heroPos, L.facePos, face);
      r.rotation.set(L.faceTilt * face, L.heroYaw + (L.faceYaw - L.heroYaw) * face + sway + tilt, 0);
      r.scale.setScalar(1 - 0.74 * glass);
      // Center the test in its block: its own middle sits a little off its origin.
      center.set(-0.3, REST_Y + 0.4, 0).applyEuler(r.rotation).multiplyScalar(r.scale.x * glass);
      r.position.sub(center);
      if (mirror.current) {
        mirror.current.position.copy(r.position);
        mirror.current.rotation.copy(r.rotation);
        mirror.current.scale.copy(r.scale);
        // The reflection only makes sense while the test rests near the floor.
        mirror.current.visible = face < 0.6;
      }
    }

    // Camera frame: corner brackets that close in around the test, then fade as the glass forms.
    if (frame.current) {
      const opacity = close * (1 - glass);
      frame.current.scale.setScalar(2.2 - 1.2 * close);
      frame.current.visible = close > 0.001 && glass < 0.999;
      frame.current.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).opacity = opacity;
      });
    }

    // The frame becomes the glass block: it appears at the viewfinder's size and closes in with
    // the test, always large enough to hold it (the test is about 12.6 units long unscaled).
    if (block.current) {
      const testScale = 1 - 0.74 * glass;
      block.current.scale.setScalar(Math.max(1, (TEST_LENGTH * testScale) / (BLOCK * 0.84)));
      block.current.visible = glass > 0.001;
    }

    // The chain: earlier records slide in from the left, one after another.
    if (chain.current) {
      chain.current.children.forEach((child, i) => {
        const k = ease(seg(link, i * 0.22, i * 0.22 + 0.5));
        child.visible = k > 0.001;
        child.scale.setScalar(Math.max(0.0001, k));
      });
    }

    cameraAt(L.keys, p, cam, look);
    state.camera.position.copy(cam);
    state.camera.lookAt(tmp.copy(look));
  });

  const glassMaterial = useMemo(
    () =>
      tier === "low"
        ? new THREE.MeshStandardMaterial({ color: "#e9dcff", transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false })
        : new THREE.MeshPhysicalMaterial({
            color: "#ffffff",
            transmission: 1,
            // Thin-walled, like an acrylic display block: a strong refraction offset duplicates
            // the test at the rounded edges, which reads as a glitch.
            thickness: 0.35,
            roughness: 0.16,
            ior: 1.3,
            attenuationColor: new THREE.Color("#efe4ff"),
            attenuationDistance: 30,
            specularIntensity: 0.6,
            envMapIntensity: 0.7,
            // On a black stage clear glass shows only where it catches light. A soft grazing-angle
            // sheen and a trace of iridescence give every face and edge a presence.
            sheen: 0.45,
            sheenRoughness: 0.25,
            sheenColor: new THREE.Color("#4a3c80"),
            iridescence: 0.2,
            iridescenceIOR: 1.3,
          }),
    [tier],
  );
  const linkMaterial = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#d9c7f5", metalness: 1, roughness: 0.28, clearcoat: 0.6 }),
    [],
  );

  const quality = tier;
  return (
    <>
      <group ref={rig}>
        <PregnancyTest
          quality={quality}
          lineProgress={driven.line}
          capLift={driven.cap}
          showCode
          code={DEMO_CODE}
          codeReveal={driven.code}
          position-y={REST_Y}
        />
        {/* Viewfinder corners, in the test's own frame so they sit square to its top face. */}
        <group ref={frame} position={[-0.3, 1.1, 0]} visible={false}>
          {[
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sz]) => (
            <group key={`${sx}${sz}`} position={[sx * 7.3, 0, sz * 2.2]}>
              <mesh position={[-sx * 0.7, 0, 0]}>
                <boxGeometry args={[1.4, 0.06, 0.12]} />
                <meshBasicMaterial color="#f3e9ff" transparent opacity={0} toneMapped={false} />
              </mesh>
              <mesh position={[0, 0, -sz * 0.6]}>
                <boxGeometry args={[0.12, 0.06, 1.2]} />
                <meshBasicMaterial color="#f3e9ff" transparent opacity={0} toneMapped={false} />
              </mesh>
            </group>
          ))}
        </group>
      </group>

      {tier !== "low" ? (
        <group scale={[1, -1, 1]}>
          <group ref={mirror}>
            <PregnancyTest quality={quality} lineProgress={driven.line} capLift={driven.cap} showCode code={DEMO_CODE} codeReveal={driven.code} position-y={REST_Y} />
          </group>
        </group>
      ) : null}

      {/* The record: a glass block around the verified test. */}
      <group ref={block} position={blockPos} visible={false}>
        <RoundedBox args={[BLOCK, BLOCK, BLOCK]} radius={0.45} smoothness={6} material={glassMaterial} />
      </group>

      {/* Earlier records, linked. */}
      <group ref={chain}>
        {Array.from({ length: PAST_BLOCKS }, (_, i) => {
          const x = blockPos[0] - (i + 1) * CHAIN_GAP;
          return (
            <group key={i} position={[x, blockPos[1], blockPos[2]]} visible={false}>
              <RoundedBox args={[BLOCK, BLOCK, BLOCK]} radius={0.45} smoothness={6} material={glassMaterial} />
              <group rotation={[L.faceTilt, L.faceYaw, 0]} scale={0.3}>
                <PregnancyTest quality="low" lineProgress={1} position-y={-0.4} />
              </group>
              {/* Link to the next block on the right. */}
              <mesh position={[CHAIN_GAP / 2, 0, 0]} rotation-z={Math.PI / 2} material={linkMaterial}>
                <cylinderGeometry args={[0.16, 0.16, CHAIN_GAP - BLOCK + 0.6, 24]} />
              </mesh>
            </group>
          );
        })}
      </group>
    </>
  );
}
