// Smoke test: the player spawns, walks forward with W, turns, and is stopped by walls.
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: ROOT, server: { port: 5291, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`${server.resolvedUrls.local[0]}?quality=low`);
await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 180000 });
await page.keyboard.press("Space"); // past the heist briefing
await page.waitForTimeout(300);
const pos = () => page.evaluate(() => window.__game.player.camera.position.asArray().map((v) => +v.toFixed(2)));
const p0 = await pos();
await page.keyboard.down("KeyW");
await page.waitForTimeout(2000);
await page.keyboard.up("KeyW");
const p1 = await pos();
// sprint into the west wall (between windows, away from the doors) for 6 s
await page.evaluate(() => (window.__game.player.yaw = -Math.PI / 2));
await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");
await page.waitForTimeout(6000);
await page.keyboard.up("KeyW");
await page.keyboard.up("ShiftLeft");
const p2 = await pos();
// runtime quality switching (the auto-probe does this on real devices)
for (const q of ["high", "medium", "low", "high"]) {
  await page.evaluate((q) => window.__game.setQuality(q), q);
  await page.waitForTimeout(1500);
}
const navOk = await page.waitForFunction(() => window.__nav === true, null, { timeout: 60000 }).then(() => true, () => false);
await browser.close();
await server.close();
const walked = p1[2] - p0[2];
const res = { p0, p1, p2, walked, navOk, errors };
console.log(JSON.stringify(res));
const ok = walked > 4 && p2[0] > -10 && p1[1] > 1.4 && p2[1] > 1.4 && navOk && !errors.length;
console.log(ok ? "✓ walk test passed" : "✗ walk test FAILED");
process.exit(ok ? 0 : 1);
