// Dev probe: load the real game headless, dismiss the intro, run JS, print the result.
//   node scripts/evalgame.mjs "<expression>" [quality] [waitMs]
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [expr, q = "low", wait = "1500"] = process.argv.slice(2);
const server = await createServer({ root: ROOT, server: { port: 5295, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: +(process.env.W ?? 800), height: +(process.env.H ?? 450) }, deviceScaleFactor: +(process.env.DPR ?? 1) });
await page.goto(`${server.resolvedUrls.local[0]}?quality=${q}`);
await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 240000 });
await page.keyboard.press("Enter");
await page.waitForTimeout(+wait);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
await server.close();
