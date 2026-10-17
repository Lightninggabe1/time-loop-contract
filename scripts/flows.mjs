// End-to-end gameplay flows in the real browser game (rendering + rules):
// blackout, chandelier drop, witnessed punch → chase → caught, midnight → summary → restart.
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: ROOT, server: { port: 5296, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || /Invalid RenderPipeline|uncaptured/.test(m.text())) && errors.push(m.text().slice(0, 300)));
await page.goto(`${server.resolvedUrls.local[0]}?quality=high`);
await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 240000 });
await page.keyboard.press("Enter");

const results = {};
const jump = (time, pos, look) =>
  page.evaluate(({ time, pos, look }) => {
    const c = window.__client, s = c.session, P = window.__game.player;
    const [h, m] = time.split(":").map(Number);
    s.elapsed = Math.max(s.elapsed, (h * 60 + m - 18 * 60) / (360 / 540));
    const V = P.camera.position.constructor;
    P.setPose(new V(pos[0], pos[1], pos[2]), 0);
    const dx = look[0] - pos[0], dy = look[1] - (pos[1] + 1.62), dz = look[2] - pos[2];
    P.yaw = Math.atan2(dx, dz);
    P.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  }, { time, pos, look });
const shot = (name) => page.screenshot({ path: `screenshots/${name}.png` });

// 1. blackout
await jump("21:40", [19.2, 0, 13.0], [20.4, 1.6, 13.4]);
await page.waitForTimeout(800);
results.offersAtFuse = await page.evaluate(() => window.__client.session.offers().map((o) => o.id));
await page.evaluate(() => window.__client.act("fuse.pull"));
await jump("21:40", [4, 0, -6], [0, 2.5, 6]);
await page.waitForTimeout(1500);
await shot("f1_blackout");
results.lightsOut = await page.evaluate(() => window.__client.session.world.flags["lights.out"]);

// 2. chandelier during the toast
await jump("23:51", [-3.5, 0, 3.0], [1.5, 3.5, 9.5]);
await page.waitForTimeout(800);
await page.evaluate(() => {
  const s = window.__client.session;
  s.player.pos = [5.4, 0.9, 13.4];
  s.world.apply([{ learn: "i.rope" }]);
});
await page.evaluate(() => window.__client.session.perform("rope.untie"));
await page.waitForTimeout(2500);
await shot("f2_chandelier");
results.c3 = await page.evaluate(() => window.__client.session.contractStatus().find((c) => c.contract.id === "toast").complete?.id ?? null);
results.seenAtRope = await page.evaluate(() => window.__client.session.chase?.by ?? null);
await page.evaluate(() => window.__client.session.escape()); // shake him off so the midnight beat can play

// 3. restart via midnight
await jump("23:59", [0, 0, -6], [0, 2, 6]);
await page.waitForTimeout(3000);
results.ended = await page.evaluate(() => window.__client.session.ended?.reason ?? null);
await shot("f3_midnight");
const t0 = Date.now();
await page.keyboard.press("Space");
await page.waitForTimeout(300);
results.restartMs = Date.now() - t0;
results.loopAfter = await page.evaluate(() => window.__client.session.meta.loop);
await shot("f4_loop2_intro");
await page.keyboard.press("Enter");

// 4. witnessed punch → chase → caught
await jump("19:05", [0, 0, 0], [0, 1.5, 1]);
await page.waitForTimeout(300);
// stand in front of Rupert on the dance floor, where plenty of guests can see
const rp = await page.evaluate(() => { const p = window.__client.session.world.npcPose("rupert"); return [p.pos[0] + Math.sin(p.yaw) * 1.1, 0, p.pos[2] + Math.cos(p.yaw) * 1.1, p.pos[0], p.pos[2]]; });
await jump("19:05", [rp[0], 0, rp[2]], [rp[3], 1.5, rp[4]]);
await page.waitForTimeout(600);
const nearest = await page.evaluate(() => window.__client.session.offers().find((o) => o.id.startsWith("punch:"))?.id);
results.punchOffer = nearest;
if (nearest) await page.evaluate((id) => window.__client.act(id), nearest);
await page.waitForTimeout(400);
results.chase = await page.evaluate(() => window.__client.session.chase?.by ?? null);
await page.waitForTimeout(1500);
await shot("f5_chase");
await page.waitForTimeout(8000);
results.caught = await page.evaluate(() => window.__client.session.ended?.reason ?? null);
await shot("f6_caught");

console.log(JSON.stringify(results, null, 1));
await browser.close();
await server.close();
console.log(errors.length ? `✗ ${errors.length} errors\n` + errors.slice(0, 6).join("\n") : "✓ no console errors");
process.exit(errors.length ? 1 : 0);
