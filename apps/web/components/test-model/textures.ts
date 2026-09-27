// Procedural textures for the test model, drawn once on a 2D canvas and cached. They stand in for
// the baked maps a supplied GLB would carry: molded-plastic micro texture, fibrous strip paper,
// absorbed-dye lines, printed markings, window smudges and the handwritten challenge code.
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const texture = make();
  cache.set(key, texture);
  return texture;
}

function canvas(width: number, height: number) {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  const ctx = el.getContext("2d")!;
  return { el, ctx };
}

// Deterministic noise so every render (and the poster) looks the same.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Smooth value noise on a grid, tiled. */
function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const rand = rng(seed);
  const grid = Array.from({ length: cells * cells }, rand);
  const out = new Float32Array(size * size);
  const at = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function heightToNormal(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const { el, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Injection-molded plastic is never perfectly smooth: fine grain plus a softer orange-peel. */
export function plasticNormal(): THREE.CanvasTexture {
  return cached("plasticNormal", () => {
    const size = 256;
    const fine = valueNoise(size, 64, 7);
    const soft = valueNoise(size, 12, 11);
    const height = fine.map((v, i) => v * 0.6 + soft[i] * 0.4);
    const texture = heightToNormal(height, size, 3.5);
    texture.repeat.set(3, 3);
    return texture;
  });
}

/** Nitrocellulose / paper: short fibers at random angles on a slightly uneven base. */
export function paperRoughness(): THREE.CanvasTexture {
  return cached("paperRoughness", () => {
    const size = 256;
    const { el, ctx } = canvas(size, size);
    const rand = rng(23);
    ctx.fillStyle = "rgb(225,225,225)";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1400; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const a = rand() * Math.PI;
      const len = 3 + rand() * 9;
      const shade = 170 + rand() * 85;
      ctx.strokeStyle = `rgba(${shade},${shade},${shade},0.55)`;
      ctx.lineWidth = 0.6 + rand() * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(el);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.repeat.set(2, 1);
    return texture;
  });
}

/**
 * Absorbed dye: a soft band across the strip whose density varies along its length and whose
 * edges bleed. Used as an alpha map (green channel), so the color stays in the material.
 */
export function dyeLine(): THREE.CanvasTexture {
  return cached("dyeLine", () => {
    const w = 64;
    const h = 256;
    const { el, ctx } = canvas(w, h);
    const img = ctx.createImageData(w, h);
    const density = valueNoise(h, 16, 41);
    const edge = valueNoise(h, 40, 43);
    for (let y = 0; y < h; y++) {
      // Density along the line, and a slightly wandering center.
      const d = 0.85 + density[y] * 0.15;
      const center = w / 2 + (edge[y] - 0.5) * 3;
      const endFade = Math.min(1, y / 8, (h - 1 - y) / 8);
      for (let x = 0; x < w; x++) {
        const dist = Math.abs(x - center) / (w * 0.2);
        const profile = Math.exp(-Math.pow(dist, 2.6));
        // Dense core, soft bleeding edges.
        const v = Math.max(0, Math.min(1, Math.pow(profile, 0.6) * d * endFade * 1.25));
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(el);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
}

/** The moving front of liquid wicking along the strip: a soft falloff behind a sharper edge. */
export function wickFront(): THREE.CanvasTexture {
  return cached("wickFront", () => {
    const w = 256;
    const h = 32;
    const { el, ctx } = canvas(w, h);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.75, "rgba(255,255,255,0.55)");
    g.addColorStop(0.93, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const texture = new THREE.CanvasTexture(el);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
}

/** Faint fingerprints and haze on the window, as a roughness map. */
export function windowSmudge(): THREE.CanvasTexture {
  return cached("windowSmudge", () => {
    const size = 128;
    const { el, ctx } = canvas(size, size);
    const rand = rng(97);
    ctx.fillStyle = "rgb(18,18,18)";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 10 + rand() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(90,90,90,0.35)");
      g.addColorStop(1, "rgba(90,90,90,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(el);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
}

/** Molded-in markings beside the window: C and T, and arrows toward the absorbent tip. */
export function markings(): THREE.CanvasTexture {
  return cached("markings", () => {
    const w = 1024;
    const h = 256;
    const { el, ctx } = canvas(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(95,92,104,0.9)";
    ctx.font = "600 64px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Positions match LineT and LineC along the window (see LINE_X in pregnancy-test.tsx).
    ctx.fillText("T", w * 0.4, h * 0.5);
    ctx.fillText("C", w * 0.62, h * 0.5);
    // Arrows pointing to the tip, printed near the cap end.
    ctx.strokeStyle = "rgba(95,92,104,0.75)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (const x of [w * 0.06, w * 0.13]) {
      ctx.beginPath();
      ctx.moveTo(x + 26, h * 0.5 - 26);
      ctx.lineTo(x, h * 0.5);
      ctx.lineTo(x + 26, h * 0.5 + 26);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(el);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  });
}

/**
 * The challenge code as the patient writes it: ballpoint ink, slightly uneven. With no code
 * (before Start) it shows four empty dashes marking where the code goes; the real code is only
 * ever passed in after the patient has started their session.
 */
export function codeInk(code: string | null): THREE.CanvasTexture {
  return cached(`codeInk:${code ?? ""}`, () => {
    const w = 512;
    const h = 256;
    const { el, ctx } = canvas(w, h);
    ctx.clearRect(0, 0, w, h);
    const rand = rng(code ? [...code].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) : 3);
    if (!code) {
      ctx.strokeStyle = "rgba(120,110,140,0.75)";
      ctx.lineWidth = 6;
      ctx.setLineDash([]);
      for (let i = 0; i < 4; i++) {
        const x = 70 + i * 100;
        ctx.beginPath();
        ctx.moveTo(x, 170);
        ctx.lineTo(x + 70, 170);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = "rgba(24,32,92,0.92)";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      [...code.slice(0, 6)].forEach((ch, i) => {
        ctx.save();
        ctx.translate(105 + i * 100, 178 + (rand() - 0.5) * 12);
        ctx.rotate((rand() - 0.5) * 0.16);
        ctx.font = `${118 + Math.round(rand() * 10)}px "Bradley Hand", "Segoe Print", "Marker Felt", "Comic Sans MS", cursive`;
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      });
    }
    const texture = new THREE.CanvasTexture(el);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  });
}
