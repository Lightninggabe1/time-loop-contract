// Load the game in WebKit (Safari's engine) with iPhone emulation and report
// where loading gets to. node scripts/webkit-load.mjs [url]
import { webkit, devices } from "playwright";
const url = process.argv[2] ?? "https://lightninggabe1.github.io/time-loop-contract/";
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices["iPhone 15 Pro landscape"] });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
const t0 = Date.now();
await page.goto(url + (url.includes("?") ? "&" : "?") + "v=" + t0);
let last = "";
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({ msg: document.getElementById("loadmsg")?.textContent, ready: window.__ready === true, engine: window.__engine }));
  const line = `${st.msg} ready=${st.ready} engine=${st.engine}`;
  if (line !== last) console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${line}`), (last = line);
  if (st.ready) break;
}
console.log(logs.filter((l) => !l.startsWith("log: BJS")).slice(0, 25).join("\n"));
await page.screenshot({ path: "screenshots/webkit_load.png" });
await browser.close();
