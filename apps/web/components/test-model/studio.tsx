"use client";

// Product-photography studio: true-black stage, a large soft key, a rose rim on one side and an
// orchid rim on the other, a faint top light. The brand color comes from the light, not the
// object. The environment is baked once (frames={1}) and only lights and reflects the model.
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

import type { Quality } from "./pregnancy-test";

export function Studio({
  quality,
  background = true,
  shadowFrames = Infinity,
}: {
  quality: Quality;
  background?: boolean;
  shadowFrames?: number;

}) {
  return (
    <>
      {background ? <color attach="background" args={["#000000"]} /> : null}
      <Environment resolution={quality === "low" ? 128 : 256} frames={1}>
        {/* Key: a large overhead softbox, slightly in front. */}
        <Lightformer form="rect" intensity={7} color="#fff6f0" scale={[18, 10, 1]} position={[-2, 12, 6]} target={[0, 0, 0]} />
        {/* Rims at the model's height, so its edges pick up rose on one side and orchid on the other. */}
        <Lightformer form="rect" intensity={14} color="#ff4fa8" scale={[3, 10, 1]} position={[-14, 1.5, -3]} target={[0, 0.5, 0]} />
        <Lightformer form="rect" intensity={14} color="#b266ff" scale={[3, 10, 1]} position={[14, 1.5, -3]} target={[0, 0.5, 0]} />
        {/* Faint top light and a low front fill strip for the long specular line. */}
        <Lightformer form="circle" intensity={1.5} color="#ffffff" scale={6} position={[0, 16, 0]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.2} color="#ffffff" scale={[24, 1.5, 1]} position={[0, 2, 14]} target={[0, 0, 0]} />
      </Environment>
      <directionalLight position={[-5, 12, 8]} intensity={1.3} color="#fff6f0" />
      {/* Black acrylic: the scene renders a mirrored copy of the model below y = 0 (high and medium
          tiers), and this graded plane over it lets only a faint, fading reflection through. */}
      {quality !== "low" ? <AcrylicFloor /> : null}
      <ContactShadows
        position={[0, 0, 0]}
        scale={30}
        blur={2.6}
        far={4}
        opacity={0.85}
        resolution={quality === "low" ? 256 : 512}
        frames={shadowFrames}
        color="#000000"
      />
    </>
  );
}

function AcrylicFloor() {
  const alpha = useMemo(() => {
    const size = 256;
    const el = document.createElement("canvas");
    el.width = el.height = size;
    const ctx = el.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Grey levels are opacity: about 3% see-through at the model (after the sRGB curve that is a
    // soft reflection), fully black by the edges.
    g.addColorStop(0, "rgb(247,247,247)");
    g.addColorStop(0.3, "rgb(252,252,252)");
    g.addColorStop(1, "rgb(255,255,255)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(el);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  }, []);
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.0005} renderOrder={1}>
      <planeGeometry args={[60, 60]} />
      <meshBasicMaterial color="#000000" transparent alphaMap={alpha} fog={false} />
    </mesh>
  );
}
