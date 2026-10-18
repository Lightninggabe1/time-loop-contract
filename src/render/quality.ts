// Quality presets. Auto-selected by a short frame-time probe, overridable in
// settings (persisted in localStorage) or via ?quality=low|medium|high.
export type Quality = "low" | "medium" | "high";

export interface Preset {
  name: Quality;
  renderScale: number; // fraction of device pixels rendered (capped DPR × this)
  maxDpr: number;
  msaa: number;
  fxaa: boolean;
  ssao: boolean;
  ssaoSamples: number;
  reflections: number; // planar floor reflection size (0 = off)
  moonShadow: number; // shadow map size
  spotShadows: number; // how many chandelier spot lights cast shadows
  spotShadowSize: number;
  bloomKernel: number;
  grain: boolean;
  dust: boolean;
}

export const PRESETS: Record<Quality, Preset> = {
  high: {
    name: "high", renderScale: 1, maxDpr: 1.25, msaa: 4, fxaa: false, ssao: true, ssaoSamples: 8,
    reflections: 1024, moonShadow: 2048, spotShadows: 2, spotShadowSize: 1024, bloomKernel: 64, grain: true, dust: true,
  },
  medium: {
    name: "medium", renderScale: 1, maxDpr: 1, msaa: 2, fxaa: true, ssao: true, ssaoSamples: 6,
    reflections: 512, moonShadow: 2048, spotShadows: 1, spotShadowSize: 1024, bloomKernel: 48, grain: true, dust: true,
  },
  low: {
    name: "low", renderScale: 0.8, maxDpr: 1, msaa: 1, fxaa: true, ssao: false, ssaoSamples: 0,
    reflections: 0, moonShadow: 1024, spotShadows: 0, spotShadowSize: 512, bloomKernel: 32, grain: false, dust: false,
  },
};

const KEY = "tlc.quality";

export function savedQuality(): Quality | null {
  const q = new URLSearchParams(location.search).get("quality");
  if (q === "low" || q === "medium" || q === "high") return q;
  try {
    const s = localStorage.getItem(KEY);
    if (s === "low" || s === "medium" || s === "high") return s;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* ignore */
  }
}

export function isMobile() {
  return matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
}

/** First guess before probing. */
export function initialQuality(): Quality {
  return savedQuality() ?? (isMobile() ? "low" : "high"); // phones: fewest shaders, fastest start; Settings can raise it
}

/** Given average frame ms at a preset, decide whether to step down. */
export function stepDown(q: Quality, avgMs: number): Quality | null {
  if (q === "high" && avgMs > 19) return "medium";
  if (q === "medium" && avgMs > 30) return "low";
  return null;
}
