// Browser flow for the front hall + library: rooms stream in after start and
// their doors open, Hale reads by the library fire, the fire bell empties the
// house into the hall, the notebook can be picked up.   node scripts/flows-hall.mjs
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: ROOT, server: { port: 5297, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || /Invalid RenderPipeline|uncaptured/.test(m.text())) && errors.push(m.text().slice(0, 300)));
// second evening: Contract 4 is unlocked
await page.addInitScript(() => localStorage.setItem("tlc.meta", JSON.stringify({ version: 1, loop: 1, memory: 0, intel: [], perks: [], completed: {}, approachesUsed: [] })));
await page.goto(`${server.resolvedUrls.local[0]}?quality=high${process.argv[2] ?? ""}`);
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

results.contracts = await page.evaluate(() => window.__client.session.contractStatus().map((c) => c.contract.id));
await page.waitForFunction(() => window.__zones?.pending === 0, null, { timeout: 120000 });
results.zones = await page.evaluate(() => window.__zones.loaded);
await page.waitForTimeout(1500);
results.grandOpen = await page.evaluate(() => window.__game.room.doors.some((d) => d.spec.id === "grand"));

// walk-through: the hall from the ballroom doors
await jump("19:20", [0, 0, -13.6], [0, 2.4, -26]);
await page.waitForTimeout(1500);
await shot("h1_hall_from_ballroom");

// Hale reading in the library
await jump("20:05", [20.6, 0, -26.5], [16.2, 1.0, -21.9]);
await page.waitForTimeout(2500);
await shot("h2_hale_reading");
results.haleTag = await page.evaluate(() => window.__client.session.world.npcPose("hale").tag);
results.knowsNotebook = await page.evaluate(() => window.__client.session.world.intel.has("i.notebook"));

// ring the bell
await jump("20:10", [8.0, 0, -26.4], [9, 1.4, -26.4]);
await page.waitForTimeout(600);
results.bellOffer = await page.evaluate(() => window.__client.session.offers().map((o) => o.id));
await page.evaluate(() => window.__client.act("firebell.ring"));
await page.waitForTimeout(500);
results.left = await page.evaluate(() => !!window.__client.session.world.flags["notebook.left"]);
// two game minutes later people are streaming into the hall
await jump("20:30", [5.5, 0, -19.5], [-2, 1.4, -30]);
await page.waitForTimeout(2500);
await shot("h3_fire_drill");
results.inHall = await page.evaluate(() => {
  const s = window.__client.session;
  return Object.keys(s.world.overrides).filter((id) => s.roomAt(s.world.npcPose(id).pos) === "foyer").length;
});

// pick up the notebook
await jump("20:31", [16.6, 0, -23.0], [16.1, 0.7, -21.9]);
await page.waitForTimeout(500);
results.chairOffer = await page.evaluate(() => window.__client.session.offers().map((o) => o.id));
await page.evaluate(() => window.__client.act("notebook.take"));
await page.waitForTimeout(500);
results.c4 = await page.evaluate(() => window.__client.session.contractStatus().find((c) => c.contract.id === "notebook")?.complete?.id ?? null);
await shot("h4_notebook");

// stairs: walk up from the foot (physics, not teleport)
await jump("20:32", [-7.1, 0, -29.6], [-7.1, 3.0, -20]);
await page.waitForTimeout(400);
await page.keyboard.down("KeyW");
await page.waitForTimeout(4200);
await page.keyboard.up("KeyW");
results.stairTop = await page.evaluate(() => window.__game.player.camera.position.asArray().map((v) => +v.toFixed(2)));
await shot("h5_stairs");

console.log(JSON.stringify(results, null, 1));
const ok = results.zones.includes("foyer") && results.zones.includes("library") && results.haleTag === "reading" && results.left && results.inHall >= 6 && results.c4 === "chaos" && results.stairTop[1] > 5.5 && !errors.length;
if (errors.length) console.log("errors:", errors.slice(0, 10));
console.log(ok ? "✓ hall flows passed" : "✗ hall flows FAILED");
await browser.close();
await server.close();
process.exit(ok ? 0 : 1);
