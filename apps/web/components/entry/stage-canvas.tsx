"use client";

// The entry group's one WebGL canvas. It lives in the (entry) layout, so it survives every navigation
// between home and the sign-in pages: the scene, materials and compiled shaders are made once.
//
// On home the target is the scroll story (one idea told in three moves):
//   hero       the control line develops on the test (on load)
//   chapter 1  the cap lifts and the test turns to face the viewer
//   chapter 2  the code is written on the test and a camera frame closes around it
//   chapter 3  the frame becomes a glass block, which links into a short chain: the audit chain
// On a sign-in page the target is that page's pose (poses.ts). Every frame the model, the camera and
// the lights damp toward the target, so an interrupted transition always continues from wherever the
// model is. Nothing here re-renders React: the route, the layout and the pointer arrive in `director`,
// scroll progress as a Motion value.
import { ContactShadows, Lightformer, PerformanceMonitor, RoundedBox } from "@react-three/drei";
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { DepthOfField, EffectComposer, N8AO, Bloom, Noise, ToneMapping } from "@react-three/postprocessing";
import { easing } from "maath";
import type { MotionValue } from "motion/react";
import { BlendFunction, ToneMappingMode, type DepthOfFieldEffect, type NoiseEffect } from "postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";

import { PregnancyTest, type Quality } from "@/components/test-model/pregnancy-test";
import { trackCanvas } from "@/components/test-model/release";
import { Renderer, REST_Y } from "@/components/test-model/scene";
import { AcrylicFloor } from "@/components/test-model/studio";

import { LIGHTS, lightFor, POSES, type EntryRoute, type Layout, type V3 } from "./poses";

type Key = { t: number; cam: V3; look: V3 };

type StoryLayout = {
  /** Vertical field of view at the design aspect; the horizontal field of view is kept constant. */
  fov: number;
  aspect: number;
  heroPos: V3;
  heroYaw: number;
  facePos: V3;
  faceYaw: number;
  faceTilt: number;
  keys: Key[];
};

// Camera keyframes along the scroll, per layout. Wide: copy on the left, the test on the right.
// Narrow (phones): copy at the bottom, the test in the upper part of the frame.
export const LAYOUTS: Record<Layout, StoryLayout> = {
  wide: {
    fov: 20,
    aspect: 1.8,
    heroPos: [5.2, REST_Y, 0.6],
    heroYaw: -0.42,
    facePos: [5, 3.4, 0],
    faceYaw: -0.12,
    faceTilt: 0.95,
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

/** How long a transition takes to settle, roughly (critically damped, never overshoots). */
const TRANSITION_SMOOTH = 0.32;
/** Once home has arrived, the story follows the scroll almost directly (the scroll is damped already). */
const FOLLOW_SMOOTH = 0.05;

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

/** What the stage wrapper tells the scene, by mutation, without re-rendering it. */
export type Director = {
  route: EntryRoute;
  layout: Layout;
  pointer: { x: number; y: number };
  /** Capture mode for the pre-rendered stills: no idle sway, no pointer tilt, the line as posed. */
  still: boolean;
  /** The line develops a beat after the canvas first shows home; other pages show it developed. */
  developed: boolean;
};

export type StageCanvasProps = {
  /** Mutated by the stage wrapper, read by the scene every frame. */
  director: RefObject<Director>;
  /** Also in director; as a prop it re-renders the story's props, which sit at layout-specific places. */
  layout: Layout;
  progress: MotionValue<number>;
  tier: Quality;
  frameloop: "demand" | "never";
  onWarm: () => void;
  onReady: () => void;
  onSettledChange: (settled: boolean) => void;
  onDecline?: () => void;
  onLost: () => void;
  onRestored: () => void;
  /** Receives the invalidate function once the canvas exists. */
  onInvalidate: (invalidate: () => void) => void;
};

export function StageCanvas(props: StageCanvasProps) {
  const { tier, frameloop } = props;
  return (
    <Canvas
      dpr={tier === "high" ? [1, 2] : [1, 1.5]}
      frameloop={frameloop}
      camera={{ fov: LAYOUTS[props.layout].fov, near: 1, far: 300 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      // A resize re-allocates every render target (the window's transmission among them); waiting for
      // the resize to finish keeps them from shimmering while a window is dragged.
      resize={{ debounce: { scroll: 0, resize: 120 } }}
      onCreated={({ gl }) => {
        trackCanvas(gl.domElement);
        const canvas = gl.domElement;
        canvas.addEventListener("webglcontextlost", (event) => {
          // Keep the context restorable, and show the stills meanwhile.
          event.preventDefault();
          props.onLost();
        });
        canvas.addEventListener("webglcontextrestored", () => props.onRestored());
      }}
      aria-hidden
    >
      <Renderer tier={tier} />
      <PerformanceMonitor onDecline={props.onDecline} flipflops={2} />
      <Lens director={props.director} />
      <StageStudio tier={tier} director={props.director} />
      <Stage {...props} />
      {tier === "high" ? <StageEffects /> : null}
      <Warmup onWarm={props.onWarm} onReady={props.onReady} onInvalidate={props.onInvalidate} />
    </Canvas>
  );
}

/**
 * Keep the horizontal field of view constant per layout, so the scene frames the same on 16:10 and
 * 16:9 (and on any phone). The stills are taller than any viewport and are cropped top and bottom by
 * object-cover, which matches this camera exactly.
 */
function Lens({ director }: { director: RefObject<Director> }) {
  useFrame(({ camera, size }) => {
    const L = LAYOUTS[director.current.layout];
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(L.fov / 2)) * L.aspect);
    const cam = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfH) / (size.width / size.height)));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }, -2);
  return null;
}

// The focus point of the depth of field follows the test wherever it goes.
const focus = new THREE.Vector3();
// Film grain: home keeps its photographic grain; face-on on a sign-in page it would read as texture.
const grain = { amount: 0.18 };

/** Compile every shader off the main thread where the browser allows, then ask for the first frames. */
function Warmup({ onWarm, onReady, onInvalidate }: { onWarm: () => void; onReady: () => void; onInvalidate: (fn: () => void) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const frames = useRef(0);
  const done = useRef(false);
  useEffect(() => {
    onInvalidate(invalidate);
    let cancelled = false;
    gl.compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) onWarm();
      });
    return () => {
      cancelled = true;
    };
    // Once, for the life of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame(() => {
    if (done.current) return;
    frames.current += 1;
    // A few real frames, so the environment, the shadows and the transmission pass are all in place.
    if (frames.current >= 4) {
      done.current = true;
      onReady();
    } else {
      invalidate();
    }
  });
  return null;
}

/**
 * Product-photography studio: true-black stage, a large soft key, a rose rim on one side and an
 * orchid rim on the other, a faint top light. The brand color comes from the light, not the object.
 * Same as <Studio />, except the rims can change: the environment is re-baked only while their
 * intensities are moving, and left alone otherwise.
 */
function StageStudio({ tier, director }: { tier: Quality; director: RefObject<Director> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const [virtual] = useState(() => new THREE.Scene());
  const resolution = tier === "low" ? 128 : 256;
  const fbo = useMemo(() => {
    const target = new THREE.WebGLCubeRenderTarget(resolution);
    target.texture.type = THREE.HalfFloatType;
    return target;
  }, [resolution]);
  const cubeCamera = useMemo(() => new THREE.CubeCamera(0.1, 1000, fbo), [fbo]);
  const rose = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const orchid = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const level = useRef({ rose: -1, orchid: -1 });
  const baked = useRef({ rose: -1, orchid: -1 });

  useLayoutEffect(() => {
    const previous = scene.environment;
    // three.js scene state, not React state (drei's <Environment> does the same).
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = fbo.texture;
    return () => {
      scene.environment = previous;
      fbo.dispose();
    };
  }, [scene, fbo]);

  useFrame((state, delta) => {
    const target = LIGHTS[lightFor(director.current.route, director.current.layout)];
    const l = level.current;
    if (l.rose < 0) Object.assign(l, target);
    const dt = Math.min(delta, 0.05);
    const moving =
      easing.damp(l, "rose", target.rose, TRANSITION_SMOOTH * 1.2, dt, Infinity, undefined, 0.02) ||
      easing.damp(l, "orchid", target.orchid, TRANSITION_SMOOTH * 1.2, dt, Infinity, undefined, 0.02);
    const b = baked.current;
    if (Math.abs(b.rose - l.rose) < 0.02 && Math.abs(b.orchid - l.orchid) < 0.02) return;
    rose.current?.material.color.set("#ff4fa8").multiplyScalar(l.rose);
    orchid.current?.material.color.set("#b266ff").multiplyScalar(l.orchid);
    const autoClear = state.gl.autoClear;
    state.gl.autoClear = true;
    cubeCamera.update(gl, virtual);
    state.gl.autoClear = autoClear;
    b.rose = l.rose;
    b.orchid = l.orchid;
    if (moving) state.invalidate();
  }, -1);

  return (
    <>
      <color attach="background" args={["#000000"]} />
      {createPortal(
        <>
          {/* Key: a large overhead softbox, slightly in front. */}
          <Lightformer form="rect" intensity={7} color="#fff6f0" scale={[18, 10, 1]} position={[-2, 12, 6]} target={[0, 0, 0]} />
          {/* Rims at the model's height, so its edges pick up rose on one side and orchid on the other. */}
          <Lightformer ref={rose} form="rect" intensity={LIGHTS.balanced.rose} color="#ff4fa8" scale={[3, 10, 1]} position={[-14, 1.5, -3]} target={[0, 0.5, 0]} />
          <Lightformer ref={orchid} form="rect" intensity={LIGHTS.balanced.orchid} color="#b266ff" scale={[3, 10, 1]} position={[14, 1.5, -3]} target={[0, 0.5, 0]} />
          {/* Faint top light and a low front fill strip for the long specular line. */}
          <Lightformer form="circle" intensity={1.5} color="#ffffff" scale={6} position={[0, 16, 0]} target={[0, 0, 0]} />
          <Lightformer form="rect" intensity={1.2} color="#ffffff" scale={[24, 1.5, 1]} position={[0, 2, 14]} target={[0, 0, 0]} />
        </>,
        virtual,
      )}
      <directionalLight position={[-5, 12, 8]} intensity={1.3} color="#fff6f0" />
      {/* Black acrylic: the scene renders a mirrored copy of the model below y = 0 (high and medium
          tiers), and this graded plane over it lets only a faint, fading reflection through. */}
      {tier !== "low" ? <AcrylicFloor /> : null}
      <ContactShadows position={[0, 0, 0]} scale={30} blur={2.6} far={4} opacity={0.85} resolution={tier === "low" ? 256 : 512} color="#000000" />
    </>
  );
}

/** Realism pass for the high tier only (desktop). Every effect stays below the point where it reads as one. */
function StageEffects() {
  const dof = useRef<DepthOfFieldEffect>(null);
  const noise = useRef<NoiseEffect>(null);
  useFrame(() => {
    dof.current?.target?.copy(focus);
    if (noise.current) noise.current.blendMode.opacity.value = grain.amount;
  });
  return (
    <EffectComposer multisampling={4}>
      <N8AO halfRes aoRadius={0.8} intensity={1.4} distanceFalloff={0.6} />
      <Bloom mipmapBlur luminanceThreshold={0.985} luminanceSmoothing={0.05} intensity={0.06} />
      <DepthOfField ref={dof} target={[0, 0, 0]} worldFocusRange={18} bokehScale={1.6} />
      <Noise ref={noise} premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.18} />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}

function Stage({ director, layout, progress, tier, onSettledChange }: StageCanvasProps) {
  const rig = useRef<THREE.Group>(null);
  const mirror = useRef<THREE.Group>(null);
  const floor = useRef<THREE.Group>(null);
  const frame = useRef<THREE.Group>(null);
  const block = useRef<THREE.Group>(null);
  const chain = useRef<THREE.Group>(null);

  // Damped state. `t` is the story's own progress; everything else is the model, camera and weights.
  const damped = useRef({
    init: false,
    t: 0,
    home: 1,
    scale: 1,
    cap: 0,
    code: 0,
    line: 0,
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    cam: new THREE.Vector3(),
    look: new THREE.Vector3(),
    settled: false,
    arrived: true,
    route: null as EntryRoute | null,
  });
  const tmp = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      euler: new THREE.Euler(),
      quat: new THREE.Quaternion(),
      cam: new THREE.Vector3(),
      look: new THREE.Vector3(),
      center: new THREE.Vector3(),
    }),
    [],
  );

  // On-demand rendering: every scroll change asks for a frame; useFrame keeps asking until settled.
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => progress.on("change", () => invalidate()), [progress, invalidate]);

  const driven = useMemo(
    () => ({
      line: { get: () => damped.current.line },
      cap: { get: () => damped.current.cap },
      code: { get: () => damped.current.code },
    }),
    [],
  );

  useFrame((state, delta) => {
    const s = damped.current;
    const d = director.current;
    const dt = Math.min(delta, 0.05);
    const L = LAYOUTS[d.layout];
    const route = d.route;
    const home = route === "home";
    if (route !== s.route) {
      s.arrived = s.route === null ? true : false;
      s.route = route;
    }

    // The story's progress: the scroll on home, rewound to the top everywhere else.
    const storyTarget = home ? progress.get() : 0;
    s.t = THREE.MathUtils.damp(s.t, storyTarget, 5, dt);
    const p = s.t;
    const face = ease(seg(p, 0.04, 0.25));
    const close = ease(seg(p, 0.3, 0.47));
    const glass = ease(seg(p, 0.52, 0.7));
    const link = seg(p, 0.72, 0.96);

    // Target pose.
    const idle = d.layout === "wide" && !d.still;
    let lineTarget = 1;
    let capTarget: number;
    let scaleTarget: number;
    if (home) {
      const sway = idle ? Math.sin(state.clock.elapsedTime * 0.22) * 0.18 * (1 - face) * s.home : 0;
      const tilt = idle ? d.pointer.x * 0.12 * (1 - face) * s.home : 0;
      lerp3(tmp.pos, L.heroPos, L.facePos, face);
      tmp.euler.set(L.faceTilt * face, L.heroYaw + (L.faceYaw - L.heroYaw) * face + sway + tilt, 0);
      const scale = 1 - 0.74 * glass;
      // Center the test in its block: its own middle sits a little off its origin.
      tmp.center.set(-0.3, REST_Y + 0.4, 0).applyEuler(tmp.euler).multiplyScalar(scale * glass);
      tmp.pos.sub(tmp.center);
      tmp.quat.setFromEuler(tmp.euler);
      cameraAt(L.keys, p, tmp.cam, tmp.look);
      capTarget = ease(seg(p, 0.05, 0.22)) * (1 - ease(seg(p, 0.47, 0.6)));
      lineTarget = d.developed ? 1 : 0;
      scaleTarget = scale;
    } else {
      const pose = POSES[d.layout][route];
      tmp.pos.set(...pose.pos);
      tmp.euler.set(pose.rot[0], pose.rot[1], pose.rot[2]);
      tmp.quat.setFromEuler(tmp.euler);
      tmp.cam.set(...pose.cam);
      tmp.look.set(...pose.look);
      capTarget = pose.cap;
      scaleTarget = pose.scale;
    }

    if (!s.init) {
      // First frame: start exactly on the target, so the still hands over without a pop.
      s.init = true;
      s.pos.copy(tmp.pos);
      s.scale = scaleTarget;
      s.quat.copy(tmp.quat);
      s.cam.copy(tmp.cam);
      s.look.copy(tmp.look);
      s.home = home ? 1 : 0;
      s.cap = capTarget;
      s.line = home && !d.developed ? 0 : lineTarget;
      s.t = storyTarget;
    }

    const smooth = home && s.arrived ? FOLLOW_SMOOTH : TRANSITION_SMOOTH;
    let moving = false;
    moving = easing.damp3(s.pos, tmp.pos, smooth, dt, Infinity, undefined, 0.0005) || moving;
    moving = easing.damp(s, "scale", scaleTarget, smooth, dt, Infinity, undefined, 0.0005) || moving;
    moving = easing.dampQ(s.quat, tmp.quat, smooth, dt, Infinity, undefined, 0.0005) || moving;
    moving = easing.damp3(s.cam, tmp.cam, smooth, dt, Infinity, undefined, 0.0005) || moving;
    moving = easing.damp3(s.look, tmp.look, smooth, dt, Infinity, undefined, 0.0005) || moving;
    // The home weight eases idle sway, pointer tilt and the story's props in and out.
    moving = easing.damp(s, "home", home ? 1 : 0, TRANSITION_SMOOTH * 0.8, dt, Infinity, undefined, 0.001) || moving;
    moving = easing.damp(s, "cap", capTarget, TRANSITION_SMOOTH * 1.3, dt, Infinity, undefined, 0.001) || moving;
    s.code = seg(p, 0.3, 0.42) * s.home;
    grain.amount = 0.06 + 0.12 * s.home;
    s.line = lineTarget; // the strip's own damping develops it (see PregnancyTest)
    if (Math.abs(s.t - storyTarget) > 0.0005) moving = true;
    if (!s.arrived && !moving) s.arrived = true;

    // Apply: the test.
    const r = rig.current;
    if (r) {
      r.position.copy(s.pos);
      r.quaternion.copy(s.quat);
      r.scale.setScalar(s.scale);
      if (mirror.current) {
        mirror.current.position.copy(r.position);
        mirror.current.quaternion.copy(r.quaternion);
        mirror.current.scale.copy(r.scale);
      }
      // The reflection belongs to a test resting on the floor. As the test lifts or tips, it flattens
      // into the floor instead of trailing below (or switching off with a pop).
      if (floor.current) {
        const up = tmp.center.set(0, 1, 0).applyQuaternion(r.quaternion).y;
        const lift = THREE.MathUtils.smoothstep(r.position.y, 0.35, 1.6);
        const tip = 1 - THREE.MathUtils.smoothstep(up, 0.7, 0.93);
        const k = (1 - lift) * (1 - tip);
        floor.current.scale.y = -Math.max(k, 0.001);
        floor.current.visible = k > 0.01;
      }
      r.getWorldPosition(focus);
    }

    // Camera frame: corner brackets that close in around the test, then fade as the glass forms.
    const extras = s.home;
    if (frame.current) {
      const opacity = close * (1 - glass) * extras;
      frame.current.scale.setScalar(2.2 - 1.2 * close);
      frame.current.visible = opacity > 0.001;
      frame.current.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).opacity = opacity;
      });
    }
    // The frame becomes the glass block: it appears at the viewfinder's size and closes in with the
    // test, always large enough to hold it. Away from home it shrinks away with the story's props.
    if (block.current) {
      const testScale = 1 - 0.74 * glass;
      block.current.scale.setScalar(Math.max(1, (TEST_LENGTH * testScale) / (BLOCK * 0.84)) * Math.max(0.0001, extras));
      block.current.visible = glass > 0.001 && extras > 0.001;
    }
    // The chain: earlier records slide in from the left, one after another.
    if (chain.current) {
      chain.current.children.forEach((child, i) => {
        const k = ease(seg(link, i * 0.22, i * 0.22 + 0.5)) * extras;
        child.visible = k > 0.001;
        child.scale.setScalar(Math.max(0.0001, k));
      });
    }

    state.camera.position.copy(s.cam);
    state.camera.lookAt(s.look);

    if (moving || (home && idle && s.home > 0.001)) state.invalidate();
    const settled = !moving;
    if (settled !== s.settled) {
      s.settled = settled;
      onSettledChange(settled);
    }
  });

  const L = LAYOUTS[layout];
  const blockPos = L.facePos;
  const glassMaterial = useMemo(
    () =>
      tier === "low"
        ? new THREE.MeshStandardMaterial({ color: "#e9dcff", transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false })
        : new THREE.MeshPhysicalMaterial({
            color: "#ffffff",
            transmission: 1,
            // Thin-walled, like an acrylic display block: a strong refraction offset duplicates the test
            // at the rounded edges, which reads as a glitch.
            thickness: 0.35,
            roughness: 0.16,
            ior: 1.3,
            attenuationColor: new THREE.Color("#efe4ff"),
            attenuationDistance: 30,
            specularIntensity: 0.6,
            envMapIntensity: 0.7,
            // On a black stage clear glass shows only where it catches light. A soft grazing-angle sheen
            // and a trace of iridescence give every face and edge a presence.
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

  const test = {
    quality: tier,
    lineProgress: driven.line,
    capLift: driven.cap,
    showCode: true,
    code: DEMO_CODE,
    codeReveal: driven.code,
    "position-y": REST_Y,
  } as const;
  return (
    <>
      <group ref={rig}>
        <PregnancyTest {...test} />
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
        <group ref={floor} scale={[1, -1, 1]}>
          <group ref={mirror}>
            <PregnancyTest {...test} />
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
