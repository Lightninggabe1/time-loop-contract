// Browser flow for the echo heists: the tutorial played for real in the
// game (round 1 holds the plate, rewind, round 2's echo holds it while you
// walk through and out with the pearls), plus heist 2's echo cracking the
// safe. Screenshots go to /screenshots/heist_*.png.   node scripts/flows-heist.mjs
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: ROOT, server: { port: 5298, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || /Invalid RenderPipeline|uncaptured/.test(m.text())) && errors.push(m.text().slice(0, 300)));
await page.goto(`${server.resolvedUrls.local[0]}?quality=high${process.argv[2] ?? ""}`);
await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 240000 });
const shot = (name) => page.screenshot({ path: `screenshots/heist_${name}.png` });
const results = {};
const fail = (msg) => {
  console.error("FAIL:", msg);
  results.failed = (results.failed ?? []).concat(msg);
};

/** Walk the player along points at a steady pace (real frames, real physics). */
const walk = (points, speed = 5) =>
  page.evaluate(
    ({ points, speed }) =>
      new Promise((res) => {
        const P = window.__game.player, V = P.camera.position.constructor;
        let i = 0;
        const cam = P.camera.position;
        let pos = new V(cam.x, 0, cam.z);
        let last = performance.now();
        const step = () => {
          const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          const t = new V(points[i][0], points[i][1], points[i][2]);
          const d = t.subtract(pos);
          d.y = 0;
          const len = d.length();
          if (len < speed * dt) {
            pos = t;
            if (++i >= points.length) {
              P.setPose(pos, P.yaw);
              return res();
            }
          } else pos.addInPlace(d.scale((speed * dt) / len));
          P.setPose(pos, Math.atan2(d.x, d.z));
          requestAnimationFrame(step);
        };
        step();
      }),
    { points, speed },
  );
const look = (at) =>
  page.evaluate((at) => {
    const P = window.__game.player, c = P.camera.position;
    P.yaw = Math.atan2(at[0] - c.x, at[2] - c.z);
    P.pitch = -Math.atan2(at[1] - c.y, Math.hypot(at[0] - c.x, at[2] - c.z));
  }, at);
const state = () =>
  page.evaluate(() => {
    const c = window.__client, r = c.round;
    return {
      heist: c.heistId, status: r.status, t: +r.seconds.toFixed(2), bodies: r.bodies.map((b) => ({ s: b.status, c: b.carrying, p: b.pos.map((v) => +v.toFixed(2)) })),
      study: r.doors.get("study")?.open, card: c.ui.open, offers: r.offers().map((o) => o.label),
    };
  });
const press = async (key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
};

// fresh save: start at heist 1
await page.evaluate(() => {
  localStorage.removeItem("tlc.heist");
});
await page.reload();
await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 240000 });
await page.waitForTimeout(800);
await shot("01_briefing");
results.briefing = await state();
if (!results.briefing.card || results.briefing.heist !== "h1") fail("briefing card for heist 1 not shown");
await press("Space");

// round 1: stand on the plate, see the door open, rewind
await look([10, 1.4, 0]);
await walk([[0, 0, -9]]);
await page.waitForTimeout(900);
results.r1 = await state();
if (!results.r1.study) fail("plate didn't open the study door");
await shot("02_on_plate");
await press("KeyQ");
await page.waitForTimeout(500);
results.r1end = await state();
if (!results.r1end.card || results.r1end.status !== "ended") fail("rewind didn't end the round");
await shot("03_keep_card");
const t0 = Date.now();
await press("Space"); // keep as echo 1
results.restartMs = Date.now() - t0;

// round 2: the echo walks to the plate; we go through and out
await page.waitForTimeout(2600);
results.r2 = await state();
if (results.r2.bodies.length !== 2) fail("round 2 has no echo");
await look([0, 1.2, -9]);
await page.waitForTimeout(300);
await shot("04_echo_on_plate");
await walk([[4, 0, -6], [8.6, 0, 0], [12, 0, 0], [16.2, 0, 0.5]], 5.5);
await look([17.1, 0.9, 0.6]);
await page.waitForTimeout(400);
results.r2desk = await state();
await shot("05_pearls");
await press("KeyE");
await page.waitForTimeout(300);
results.r2took = await state();
if (results.r2took.bodies[1].c !== "pearls") fail(`didn't pick up the pearls (offers: ${results.r2desk.offers.join(", ")})`);
await walk([[12, 0, 0], [8, 0, 0], [0, 0, 0], [-8.6, 0, 0], [-12, 0, 0.3], [-15, 0, 0.6]], 6);
await page.waitForTimeout(700);
results.r2end = await state();
if (results.r2end.status !== "won") fail(`tutorial not won: ${results.r2end.status}`);
await shot("06_won");

// heist 2: the briefing, then a look at Brock on his round
await press("Space"); // next heist
await page.waitForTimeout(800);
results.h2 = await state();
if (results.h2.heist !== "h2") fail("next heist didn't open");
await press("Space");
await walk([[6, 0, -6], [8.4, 0, 0]], 5);
await look([15, 1.5, -3]);
await page.waitForTimeout(1200);
await shot("07_brock");
results.h2r1 = await state();

results.errors = errors;
console.log(JSON.stringify(results, null, 1));
await browser.close();
await server.close();
process.exit(errors.length || results.failed ? 1 : 0);
