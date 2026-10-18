// Phone check in WebKit (Safari's engine) with iPhone emulation: loading time,
// how much of the screen the HUD covers, the touch controls, and the end screen's
// "Again" button tapped the way a thumb does it.  node scripts/mobile.mjs [--dist]
import { webkit, chromium, devices } from "playwright";
import { createServer, preview } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dist = process.argv.includes("--dist");
const server = dist ? await preview({ root: ROOT, preview: { port: 5299 }, logLevel: "error" }) : await createServer({ root: ROOT, server: { port: 5299, strictPort: false }, logLevel: "error" });
if (!dist) await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await (process.argv.includes("--chromium") ? chromium : webkit).launch();
const out = {};
const errors = [];
for (const [tag, dev] of [["land", devices["iPhone 15 Pro landscape"]], ["port", devices["iPhone 15 Pro"]]]) {
  const ctx = await browser.newContext({ ...dev });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text().slice(0, 200)}`));
  const t0 = Date.now();
  await page.goto(base);
  await page.waitForFunction(() => window.__ready === true && window.__client?.isReady, null, { timeout: 240000 });
  out[`${tag}.loadS`] = (Date.now() - t0) / 1000;
  out[`${tag}.engine`] = await page.evaluate(() => window.__engine);
  await page.screenshot({ path: `screenshots/m_${tag}_0intro.png` });
  await page.tap(".g-intro button");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/m_${tag}_1hud.png` });
  // how much of the screen do HUD panels cover? (excluding the round touch buttons)
  out[`${tag}.hudCover`] = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    let a = 0;
    for (const s of ["#clock", ".g-tracker", ".g-toasts", ".g-prompt", "#settings-btn", ".g-touch-board"]) {
      const e = document.querySelector(s);
      if (!e) continue;
      const r = e.getBoundingClientRect();
      a += Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    }
    return +(a / (W * H)).toFixed(3);
  });
  // walk: a thumb on the left side over the tracker should still move the player
  const before = await page.evaluate(() => window.__game.player.camera.position.asArray());
  const tr = await page.evaluate(() => { const r = document.querySelector(".g-tracker").getBoundingClientRect(); return [r.left + 40, r.top + 20]; });
  const cdp = await page.evaluate(async ([x, y]) => {
    try { new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: 0 }); } catch { return "skip (no synthetic touches in this engine)"; }
    const target = document.elementFromPoint(x, y);
    const mk = (type, cx, cy) => new TouchEvent(type, { bubbles: true, cancelable: true, changedTouches: [new Touch({ identifier: 7, target, clientX: cx, clientY: cy })], touches: type === "touchend" ? [] : [new Touch({ identifier: 7, target, clientX: cx, clientY: cy })] });
    target.dispatchEvent(mk("touchstart", x, y));
    for (let i = 1; i <= 10; i++) { target.dispatchEvent(mk("touchmove", x, y - i * 6)); await new Promise((r) => setTimeout(r, 30)); }
    await new Promise((r) => setTimeout(r, 900));
    target.dispatchEvent(mk("touchend", x, y - 60));
    return target.className || target.id || target.tagName;
  }, tr);
  const after = await page.evaluate(() => window.__game.player.camera.position.asArray());
  out[`${tag}.walkFrom`] = cdp;
  out[`${tag}.walked`] = +Math.hypot(after[0] - before[0], after[2] - before[2]).toFixed(2);
  // expand the tracker
  await page.tap(".g-more");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/m_${tag}_2tracker.png` });
  await page.tap(".g-more");
  // end of the evening → tap Again, twice over two loops
  for (let k = 0; k < 2; k++) {
    await page.evaluate(() => window.__client.session.end("caught"));
    await page.waitForTimeout(800);
    if (k === 0) await page.screenshot({ path: `screenshots/m_${tag}_3end.png` });
    const loop0 = await page.evaluate(() => window.__client.session.meta.loop);
    await page.locator(".g-again").scrollIntoViewIfNeeded();
    await page.tap(".g-again");
    await page.waitForTimeout(600);
    out[`${tag}.again${k}`] = (await page.evaluate(() => window.__client.session.meta.loop)) === loop0 + 1 && (await page.evaluate(() => !window.__client.session.ended));
    await page.tap(".g-intro button");
    await page.waitForTimeout(300);
  }
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
await (server.close?.() ?? server.httpServer?.close());
console.log(errors.length ? `✗ ${errors.length} errors\n` + errors.slice(0, 8).join("\n") : "✓ no console errors");
process.exit(errors.length ? 1 : 0);
