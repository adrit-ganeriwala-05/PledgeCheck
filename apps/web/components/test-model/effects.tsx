"use client";

// Realism pass for the high tier only (landing page, desktop). Every effect is kept below the
// point where it reads as an effect.
import { Bloom, DepthOfField, EffectComposer, N8AO, Noise, ToneMapping } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";

export function Effects({ focusDistance = 32 }: { focusDistance?: number }) {
  return (
    <EffectComposer multisampling={4}>
      <N8AO halfRes aoRadius={0.8} intensity={1.4} distanceFalloff={0.6} />
      <Bloom mipmapBlur luminanceThreshold={0.96} luminanceSmoothing={0.1} intensity={0.12} />
      <DepthOfField worldFocusDistance={focusDistance} worldFocusRange={9} bokehScale={1.6} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.18} />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}
