// Readability pass: conversation menu, name tags, the Lead marker and the
// painting that hides the safe — in the real browser game. Desktop + phone.
import { chromium, devices } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: ROOT, server: { port: 5297, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const errors = [];
const results = {};

async function run(tag, ctxOpts, quality) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => (m.type() === "error" || /Invalid RenderPipeline|uncaptured/.test(m.text())) && errors.push(m.text().slice(0, 300)));
  await page.goto(`${server.resolvedUrls.local[0]}?quality=${quality}`);
  await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 240000 });
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__client.ui.hideIntro());
  const shot = (n) => page.screenshot({ path: `screenshots/${tag}_${n}.png` });
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
  /** stand in front of an NPC, looking at them */
  const face = async (time, npc, d = 1.6) => {
    await jump(time, [0, 0, 0], [0, 1, 1]);
    await page.waitForTimeout(200);
    const p = await page.evaluate((npc) => {
      const pose = window.__client.session.world.npcPose(npc);
      return [pose.pos[0] + Math.sin(pose.yaw) * 1.6, pose.pos[1], pose.pos[2] + Math.cos(pose.yaw) * 1.6, pose.pos[0], pose.pos[2]];
    }, npc);
    await jump(time, [p[0], p[1], p[2]], [p[3], 1.5, p[4]]);
    await page.waitForTimeout(700);
  };

  // 1. start of the evening: the Lead marker and name tags in the ballroom
  await jump("18:05", [0, 0, -9], [2, 1.5, -2]);
  await page.waitForTimeout(900);
  await shot("1_lead");
  results[`${tag}.pin`] = await page.evaluate(() => !document.querySelector(".g-pin").hidden);
  results[`${tag}.tags`] = await page.evaluate(() => [...document.querySelectorAll(".g-tag")].map((t) => t.textContent));

  // 2. talk to Mrs Pryce
  await face("18:20", "pryce");
  results[`${tag}.offer0`] = await page.evaluate(() => document.querySelector(".g-offer.primary")?.textContent);
  await page.evaluate(() => window.__client.act("talk:pryce"));
  await page.waitForTimeout(300);
  await shot("2_talk");
  results[`${tag}.options`] = await page.evaluate(() => [...document.querySelectorAll(".g-opt")].map((b) => b.textContent));
  if (tag === "desk") await page.keyboard.press("Digit2");
  else await page.locator(".g-opt").nth(1).tap();
  await page.waitForTimeout(400);
  await shot("3_reply");
  results[`${tag}.reply`] = await page.evaluate(() => document.querySelector(".g-line")?.textContent);
  results[`${tag}.learnedSafe`] = await page.evaluate(() => window.__client.session.world.intel.has("i.safe"));
  if (tag === "desk") await page.keyboard.press("Escape");
  else await page.locator(".g-opt.bye").tap();
  await page.waitForTimeout(400);
  results[`${tag}.closed`] = await page.evaluate(() => !window.__client.ui.talking);

  // 3. a greyed-out social move
  await page.evaluate(() => window.__client.session.world.learn("i.affair"));
  await face("19:45", "calloway");
  await page.evaluate(() => window.__client.act("talk:calloway"));
  await page.waitForTimeout(300);
  await shot("4_locked");
  await page.evaluate(() => window.__client.ui.closeTalk());

  // 4. the painting in the study
  await jump("21:40", [18.3, 0, 0.4], [20.4, 2.9, 0]);
  await page.waitForTimeout(900);
  await shot("5_painting");
  results[`${tag}.paintingOffer`] = await page.evaluate(() => document.querySelector(".g-offer.primary")?.textContent);
  await page.evaluate(() => window.__client.act("painting.swing"));
  await page.waitForTimeout(1200);
  await shot("6_safe");
  results[`${tag}.safeOffer`] = await page.evaluate(() => [...document.querySelectorAll(".g-offer")].map((b) => b.textContent));
  await ctx.close();
}

await run("desk", { viewport: { width: 1600, height: 900 } }, "high");
await run("phone", { ...devices["iPhone 13 landscape"] }, "low");
console.log(JSON.stringify(results, null, 1));
await browser.close();
await server.close();
console.log(errors.length ? `✗ ${errors.length} errors\n` + errors.slice(0, 6).join("\n") : "✓ no console errors");
process.exit(errors.length ? 1 : 0);
