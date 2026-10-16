// Gameplay screenshots: real game (NPCs, HUD), clock jumped to story beats.
//   node scripts/playshots.mjs            all beats
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BEATS = [
  { name: "p1_greeting", time: "18:02", pos: [0, 0, -9.5], look: [0.4, 1.4, -13] },
  { name: "p2_tower", time: "19:33", pos: [1.6, 0, 6.0], look: [0, 1.5, 8.6] },
  { name: "p3_speech", time: "20:22", pos: [-1.5, 0, 6.5], look: [0, 2.2, 11.5] },
  { name: "p4_study_deal", time: "20:50", pos: [12.4, 0, 0.6], look: [15.6, 1.4, 4.4] },
  { name: "p5_kitchen_nap", time: "20:08", pos: [12.0, 0, 11.2], look: [13.4, 1.0, 7.4] },
  { name: "p6_song", time: "22:03", pos: [-2.5, 0, 4.0], look: [0, 2.0, 11.5] },
  { name: "p7_balcony", time: "22:05", pos: [-11.6, 0, -1.5], look: [-15, 1.4, -4.8] },
  { name: "p8_dance", time: "23:22", pos: [4.0, 0, -4.0], look: [0.5, 1.4, 2.0] },
];
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const server = await createServer({ root: ROOT, server: { port: 5294, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || /Invalid RenderPipeline|uncaptured/.test(m.text())) && errors.push(m.text().slice(0, 300)));
await page.goto(`${server.resolvedUrls.local[0]}?quality=high`);
await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 240000 });
await page.keyboard.press("Enter"); // dismiss intro
for (const b of BEATS) {
  if (only && !only.includes(b.name)) continue;
  await page.evaluate(({ b }) => {
    const c = window.__client, s = c.session;
    const [h, m] = b.time.split(":").map(Number);
    const target = h * 60 + m;
    s.elapsed = (target - 18 * 60) / (360 / 540);
    const P = window.__game.player;
    P.setPose({ x: b.pos[0], y: b.pos[1], z: b.pos[2], add: undefined, clone() { return this; } }.constructor === Object ? new (window.__game.player.camera.position.constructor)(b.pos[0], b.pos[1], b.pos[2]) : null, 0);
    const cam = P.camera;
    const dx = b.look[0] - b.pos[0], dy = b.look[1] - (b.pos[1] + 1.62), dz = b.look[2] - b.pos[2];
    P.yaw = Math.atan2(dx, dz);
    P.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    cam.rotation.set(P.pitch, P.yaw, 0);
  }, { b });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `screenshots/${b.name}.png` });
  console.log("  ", b.name);
}
await browser.close();
await server.close();
console.log(errors.length ? `✗ ${errors.length} errors\n` + errors.slice(0, 8).join("\n") : "✓ no console errors");
process.exit(errors.length ? 1 : 0);
