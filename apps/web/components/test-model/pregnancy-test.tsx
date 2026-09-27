"use client";

// Procedural, unbranded at-home pregnancy test (midstream style), in centimeters.
//
// It has the same separately named nodes a supplied GLB must have (Body, Cap, Window, Strip,
// LineC, LineT), so public/models/pregnancy-test.glb can replace it later: run
// `npx gltfjsx pregnancy-test.glb --transform --types`, keep this component's props, and drive the
// generated nodes the same way. Nothing outside this file needs to change.
//
// Content rule: only the control line (LineC) ever develops. LineT exists for parity with the
// GLB and is never shown: the product verifies tests, it never announces results.
import { RoundedBox } from "@react-three/drei";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { codeInk, dyeLine, markings, paperRoughness, plasticNormal, wickFront, windowSmudge } from "./textures";

export type Quality = "high" | "medium" | "low";

/** A number, or anything with get() (a Motion value), read every frame without re-rendering. */
export type Driven = number | { get(): number };
const read = (v: Driven) => (typeof v === "number" ? v : v.get());

export type PregnancyTestProps = {
  /** 0-1: liquid wicks along the strip, then the control line's dye develops. */
  lineProgress?: Driven;
  /** 0-1: the cap lifts off and slides away, showing the absorbent tip. */
  capLift?: Driven;
  /** Show the code area beside the window: the handwritten code, or empty dashes when code is null. */
  showCode?: boolean;
  code?: string | null;
  /** 0-1: how much of the handwritten code has been written (fades the ink in). */
  codeReveal?: Driven;
  quality?: Quality;
} & Omit<ThreeElements["group"], "children">;

// Layout, in cm. Body lies along X with its top face at y = THICK.
const THICK = 0.75;
const HALF_W = 1.05;
const BODY_X: [number, number] = [-3.5, 6.0];
const WIN = { x0: -2.2, x1: 0.9, halfW: 0.48, r: 0.32 };
// The markings texture places T and C at 40% and 62% of this span (see textures.ts).
const MARK = { x0: -2.927, width: 4.318 };
export const LINE_X = { T: MARK.x0 + 0.4 * MARK.width, C: MARK.x0 + 0.62 * MARK.width };
const STRIP_Y = 0.62;

function roundedRect(shape: THREE.Shape | THREE.Path, x0: number, y0: number, x1: number, y1: number, r: number) {
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  return shape;
}

/** Extrude a top-view outline into a slab lying flat, bottom at y = 0, edges fully rounded. */
function slab(shape: THREE.Shape, thickness: number, bevel: number, bevelSize = bevel) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, thickness - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize,
    bevelSegments: 10,
    curveSegments: 48,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function useGeometry() {
  return useMemo(() => {
    const outline = roundedRect(new THREE.Shape(), BODY_X[0], -HALF_W, BODY_X[1], HALF_W, 0.9) as THREE.Shape;
    outline.holes.push(roundedRect(new THREE.Path(), WIN.x0, -WIN.halfW, WIN.x1, WIN.halfW, WIN.r) as THREE.Path);
    const body = slab(outline, THICK, 0.2, 0.16);

    // Clear window, set a little below the top face so the opening reads as recessed.
    const pane = roundedRect(new THREE.Shape(), WIN.x0 - 0.1, -WIN.halfW - 0.1, WIN.x1 + 0.1, WIN.halfW + 0.1, WIN.r + 0.1) as THREE.Shape;
    const windowPane = slab(pane, 0.06, 0.02);
    windowPane.translate(0, THICK - 0.1, 0);

    // Cap: a rounded tip at the far end, open end squared off with soft corners.
    const cap = new THREE.Shape();
    const capR = 1.17;
    cap.moveTo(-5.45, -capR);
    cap.lineTo(-3.45, -capR);
    cap.quadraticCurveTo(-3.08, -capR, -3.08, -capR + 0.37);
    cap.lineTo(-3.08, capR - 0.37);
    cap.quadraticCurveTo(-3.08, capR, -3.45, capR);
    cap.lineTo(-5.45, capR);
    cap.absarc(-5.45, 0, capR, Math.PI / 2, (Math.PI * 3) / 2, false);
    const capGeometry = slab(cap, 1.04, 0.3, 0.22);
    capGeometry.translate(0, THICK / 2 - 0.52, 0);

    return { body, windowPane, capGeometry };
  }, []);
}

function useMaterials(quality: Quality) {
  return useMemo(() => {
    const normal = plasticNormal();
    const physical = quality !== "low";

    const body = physical
      ? new THREE.MeshPhysicalMaterial({
          color: "#f4f1ec",
          roughness: 0.4,
          clearcoat: 0.35,
          clearcoatRoughness: 0.45,
          sheen: 0.35,
          sheenRoughness: 0.8,
          sheenColor: new THREE.Color("#ffffff"),
          normalMap: normal,
          normalScale: new THREE.Vector2(0.12, 0.12),
        })
      : new THREE.MeshStandardMaterial({
          color: "#f1eee8",
          roughness: 0.45,
          normalMap: normal,
          normalScale: new THREE.Vector2(0.12, 0.12),
        });

    const cap = physical
      ? new THREE.MeshPhysicalMaterial({
          color: "#c41a66",
          roughness: 0.26,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          normalMap: normal,
          normalScale: new THREE.Vector2(0.05, 0.05),
        })
      : new THREE.MeshStandardMaterial({ color: "#b8175f", roughness: 0.3 });

    // Clear polycarbonate. Low tier trades real transmission for a cheap tinted pane.
    const pane = physical
      ? new THREE.MeshPhysicalMaterial({
          color: "#ffffff",
          transmission: 1,
          thickness: 0.07,
          ior: 1.58,
          roughness: 0.02,
          roughnessMap: windowSmudge(),
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          specularIntensity: 1,
          attenuationColor: new THREE.Color("#f6f2ff"),
          attenuationDistance: 2,
        })
      : new THREE.MeshStandardMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: 0.16,
          roughness: 0.05,
          metalness: 0,
          depthWrite: false,
        });

    const paperRough = paperRoughness();
    const strip = new THREE.MeshStandardMaterial({ color: "#f6f4ef", roughness: 0.95, roughnessMap: paperRough });
    const wick = new THREE.MeshStandardMaterial({ color: "#f3f1ea", roughness: 1, roughnessMap: paperRough });

    // With a transmissive window the dye must be alpha-hashed, because the transmission pass only
    // sees opaque meshes (at high DPR the hash reads as dye grain). The low tier's plain pane
    // allows ordinary blending.
    const dye = new THREE.MeshStandardMaterial({
      color: "#b0104f",
      roughness: 0.95,
      alphaHash: physical,
      transparent: !physical,
      depthWrite: physical,
      alphaMap: dyeLine(),
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const front = new THREE.MeshBasicMaterial({
      color: "#f0c4d8",
      alphaHash: physical,
      transparent: !physical,
      depthWrite: physical,
      alphaMap: wickFront(),
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const print = new THREE.MeshStandardMaterial({
      map: markings(),
      transparent: true,
      roughness: 0.6,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    return { body, cap, pane, strip, wick, dye, front, print };
  }, [quality]);
}

export function PregnancyTest({
  lineProgress = 1,
  capLift = 0,
  showCode = false,
  code = null,
  codeReveal = 1,
  quality = "medium",
  ...group
}: PregnancyTestProps) {
  const geometry = useGeometry();
  const materials = useMaterials(quality);
  const ink = useMemo(() => {
    if (!showCode) return null;
    return new THREE.MeshStandardMaterial({
      map: codeInk(code),
      transparent: true,
      roughness: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  }, [showCode, code]);

  const capRef = useRef<THREE.Mesh>(null);
  const frontRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>(null);
  const lineRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>(null);
  const inkRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>(null);
  const progress = useRef<number | null>(null);
  const lift = useRef<number | null>(null);

  // Weighted easing toward the targets: physical, never bouncy.
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const targetLine = read(lineProgress);
    const targetLift = read(capLift);
    progress.current = THREE.MathUtils.damp(progress.current ?? targetLine, targetLine, 2.4, dt);
    lift.current = THREE.MathUtils.damp(lift.current ?? targetLift, targetLift, 3, dt);
    const p = progress.current;

    // Liquid front runs along the strip in the first half, then fades as it passes.
    const run = THREE.MathUtils.clamp(p / 0.55, 0, 1);
    const frontX = THREE.MathUtils.lerp(WIN.x0 - 0.5, WIN.x1 + 0.6, run);
    if (frontRef.current) {
      frontRef.current.position.x = frontX - 0.6;
      frontRef.current.material.opacity = run > 0 && run < 1 ? 0.55 * Math.sin(run * Math.PI) : 0;
    }
    // Control line develops once the liquid has passed it.
    if (lineRef.current) lineRef.current.material.opacity = THREE.MathUtils.smoothstep(p, 0.38, 1);

    if (inkRef.current) inkRef.current.material.opacity = THREE.MathUtils.clamp(read(codeReveal), 0, 1);

    const l = lift.current;
    if (capRef.current) {
      capRef.current.position.set(-2.6 * l, 1.1 * Math.sin(l * Math.PI * 0.5), 0);
      capRef.current.rotation.z = 0.12 * l;
    }
    if (Math.abs(p - targetLine) > 0.001 || Math.abs(l - targetLift) > 0.001) state.invalidate();
  });

  return (
    <group {...group}>
      <group name="Body">
        <mesh geometry={geometry.body} material={materials.body} castShadow receiveShadow />
        {/* Textured grip at the handle end. */}
        {Array.from({ length: 7 }, (_, i) => (
          <RoundedBox
            key={i}
            args={[0.09, 0.07, 1.25]}
            radius={0.03}
            smoothness={3}
            position={[3.9 + i * 0.25, THICK + 0.01, 0]}
            material={materials.body}
            castShadow
          />
        ))}
        {/* Molded markings: C, T and arrows toward the tip. */}
        <mesh position={[MARK.x0 + MARK.width / 2, THICK + 0.002, -(WIN.halfW + 0.33)]} rotation-x={-Math.PI / 2} material={materials.print}>
          <planeGeometry args={[MARK.width, MARK.width / 4]} />
        </mesh>
        {/* Absorbent tip, hidden under the cap until it lifts. */}
        <RoundedBox name="Wick" args={[2.7, 0.42, 1.5]} radius={0.14} smoothness={4} position={[-4.75, THICK / 2, 0]} material={materials.wick} />
        {ink ? (
          <mesh ref={inkRef} position={[2.3, THICK + 0.003, 0]} rotation-x={-Math.PI / 2} material={ink}>
            <planeGeometry args={[2.1, 1.05]} />
          </mesh>
        ) : null}
      </group>

      <group name="Strip">
        <mesh position={[(WIN.x0 + WIN.x1) / 2, STRIP_Y, 0]} rotation-x={-Math.PI / 2} material={materials.strip} receiveShadow>
          <planeGeometry args={[WIN.x1 - WIN.x0 + 0.4, WIN.halfW * 2 + 0.2]} />
        </mesh>
        <mesh ref={frontRef} position={[WIN.x0, STRIP_Y + 0.001, 0]} rotation-x={-Math.PI / 2} material={materials.front}>
          <planeGeometry args={[1.2, WIN.halfW * 2 + 0.1]} />
        </mesh>
        <mesh name="LineC" ref={lineRef} position={[LINE_X.C, STRIP_Y + 0.002, 0]} rotation-x={-Math.PI / 2} material={materials.dye}>
          <planeGeometry args={[0.3, WIN.halfW * 2 - 0.04]} />
        </mesh>
        {/* Never shown (see the content rule above). */}
        <mesh name="LineT" visible={false} position={[LINE_X.T, STRIP_Y + 0.002, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.22, WIN.halfW * 2 - 0.04]} />
        </mesh>
      </group>

      <mesh name="Window" geometry={geometry.windowPane} material={materials.pane} />
      <mesh name="Cap" ref={capRef} geometry={geometry.capGeometry} material={materials.cap} castShadow receiveShadow />
    </group>
  );
}
