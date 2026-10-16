// Screenshot + perf harness. Starts Vite (dev) or serves dist/ (--dist),
// opens each preset camera spot in headless Chromium, saves PNGs to
// screenshots/, reports relative frame time per preset, and fails on any
// console error.
//   node scripts/shots.mjs                 all shots, high
//   node scripts/shots.mjs --q=low,high    presets
//   node scripts/shots.mjs --only=01_entrance
//   node scripts/shots.mjs --check         CI mode (fewer shots, perf, errors)
import { chromium } from "playwright";
import { createServer, preview } from "vite";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const check = process.argv.includes("--check");
const useDist = process.argv.includes("--dist");
const presets = arg("q", check ? "low,medium,high" : "high").split(",");
const engineParam = arg("engine", "");
const W = Number(arg("w", 1600)), H = Number(arg("h", 900)), DPR = Number(arg("dpr", 1));
const layout = JSON.parse(await readFile(join(ROOT, "src/level/layouts/ballroom.json"), "utf8"));
const only = arg("only", "");
const shots = layout.shots.map((s) => s.name).filter((n) => !only || only.split(",").includes(n));
const outDir = join(ROOT, "screenshots", arg("dir", check ? "check" : ""));
await mkdir(outDir, { recursive: true });

const server = useDist
  ? await preview({ root: ROOT, preview: { port: 4317, strictPort: false }, logLevel: "error" })
  : await createServer({ root: ROOT, server: { port: 5288, strictPort: false }, logLevel: "error" }).then(async (s) => (await s.listen(), s));
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"],
});
const errors = [];
const perf = {};
let engineName = "?";

for (const q of presets) {
  for (const name of check ? shots.slice(0, 1) : shots) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
    page.on("console", (m) => {
      const gpuInvalid = /Invalid RenderPipeline|infringes limits|validation error|WebGPU uncaptured/i.test(m.text());
      if (m.type() === "error" || gpuInvalid) errors.push(`[${q}/${name}] ${m.text().slice(0, 300)}`);
      else if (process.argv.includes("--verbose") && m.type() === "warning") console.log("   warn:", m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => errors.push(`[${q}/${name}] ${e.message}`));
    const url = `${base}?shot=${name}&quality=${q}${engineParam ? `&engine=${engineParam}` : ""}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    engineName = await page.evaluate(() => window.__engine);
    const ev = arg("eval", "");
    if (ev) console.log("  eval:", JSON.stringify(await page.evaluate(ev)));
    await page.waitForTimeout(600);
    const file = join(outDir, `${name}${presets.length > 1 ? `_${q}` : ""}.png`);
    await page.screenshot({ path: file });
    if (!perf[q]) perf[q] = await page.evaluate(() => window.__game.bench(60));
    const errs = await page.evaluate(() => window.__errors);
    for (const e of errs) errors.push(`[${q}/${name}] ${e}`);
    console.log(`  ${q.padEnd(6)} ${name}  →  ${file.replace(ROOT, "")}`);
    await page.close();
  }
}
await browser.close();
await server.close?.();
server.httpServer?.close?.();

console.log(`\nRelative frame time (${engineName}, ${W}x${H}@${DPR}x, headless — relative only):`);
for (const [q, ms] of Object.entries(perf)) console.log(`  ${q.padEnd(6)} ${ms.toFixed(1)} ms  (${(1000 / ms).toFixed(0)} fps)`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} console error(s):`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log("\n✓ no console errors");
process.exit(0);
