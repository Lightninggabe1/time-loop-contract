// Feature cost profiler: benches the High preset with one feature removed at a time.
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: ROOT, server: { port: 5290, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1470, height: 956 }, deviceScaleFactor: 2 });
await page.goto(`${server.resolvedUrls.local[0]}?shot=01_entrance&quality=${process.argv[2] ?? "high"}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const r = await page.evaluate(async () => {
  const g = window.__game, out = {};
  const b = async () => (await g.bench(40)).toFixed(1);
  out.base = await b();
  const toggles = {
    ssr: (on) => g.post.ssr && (g.scene.postProcessRenderPipelineManager[on ? "attachCamerasToRenderPipeline" : "detachCamerasFromRenderPipeline"]("ssr", g.scene.activeCamera)),
    ssao: (on) => g.post.ssao && (g.scene.postProcessRenderPipelineManager[on ? "attachCamerasToRenderPipeline" : "detachCamerasFromRenderPipeline"]("ssao", g.scene.activeCamera)),
    msaa: (on) => (g.post.def.samples = on ? 4 : 1),
    mirror: (on) => g.mirrors.tex && (g.mirrors.tex.refreshRate = on ? 2 : 0),
    bloom: (on) => (g.post.def.bloomEnabled = on),
    chroma: (on) => (g.post.def.chromaticAberrationEnabled = on),
    grainSharpen: (on) => ((g.post.def.grainEnabled = on), (g.post.def.sharpenEnabled = on)),
    particles: (on) => g.scene.particleSystems.forEach((p) => (on ? p.start() : p.stop())),
  };
  for (const [k, f] of Object.entries(toggles)) {
    f(false);
    out["-" + k] = await b();
    f(true);
  }
  g.engine.setHardwareScalingLevel(1 / 1.0);
  out["dpr1.0"] = await b();
  g.engine.setHardwareScalingLevel(1 / 1.25);
  out["dpr1.25"] = await b();
  return out;
});
console.log(r);
await browser.close();
await server.close();
