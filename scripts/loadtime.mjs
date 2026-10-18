// Time-to-playable on a throttled connection (default 10 Mbit/s, 40 ms RTT),
// from the production build. Reports each loading step, the bytes fetched
// before the loading screen lifts, and what keeps streaming afterwards.
//   node scripts/loadtime.mjs [--mbps=10] [--q=low] [--engine=webgl]
import { chromium } from "playwright";
import { preview } from "vite";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const mbps = Number(arg("mbps", 10));
const q = arg("q", "medium");
const engine = arg("engine", "");

const server = await preview({ root: ROOT, preview: { port: 4319, strictPort: false }, logLevel: "error" });
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: 2e6 / 8 });
let bytes = 0, bytesAtPlay = -1, playable = false;
const urls = new Map(), early = new Map();
cdp.on("Network.requestWillBeSent", (e) => urls.set(e.requestId, e.request.url));
cdp.on("Network.loadingFinished", (e) => {
  bytes += e.encodedDataLength;
  if (playable) return;
  const u = new URL(urls.get(e.requestId) ?? "x:/?").pathname.replace(/^\/+/, "");
  const k = u.startsWith("assets/") && !u.endsWith(".js") ? u.split("/").slice(0, 3).join("/") : u.endsWith(".js") ? "js" : u;
  early.set(k, (early.get(k) ?? 0) + e.encodedDataLength);
});
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => errors.push(e.message));

const t0 = Date.now();
await page.goto(`${base}?quality=${q}${engine ? `&engine=${engine}` : ""}`);
let last = "";
for (;;) {
  const st = await page.evaluate(() => ({
    msg: document.getElementById("loadmsg")?.textContent ?? "",
    done: document.getElementById("loading")?.classList.contains("done"),
    zones: window.__zones ?? null,
  }));
  const line = st.done ? "PLAYABLE" : st.msg;
  if (line !== last) {
    console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${line}`);
    last = line;
  }
  if (st.done && bytesAtPlay < 0) (bytesAtPlay = bytes), (playable = true);
  if (st.done && (!st.zones || st.zones.pending === 0)) {
    if (st.zones) console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  all rooms streamed in (${st.zones.loaded.join(", ")})`);
    break;
  }
  if (Date.now() - t0 > 300000) {
    console.log("timed out");
    break;
  }
  await page.waitForTimeout(250);
}
console.log(`\nfetched before playable: ${(bytesAtPlay / 1e6).toFixed(1)} MB · total: ${(bytes / 1e6).toFixed(1)} MB (${mbps} Mbit/s)`);
if (process.argv.includes("--detail"))
  for (const [k, v] of [...early].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(v / 1e6).toFixed(2).padStart(6)} MB  ${k}`);
if (errors.length) console.log("errors:\n  " + errors.join("\n  "));
await browser.close();
server.httpServer?.close?.();
process.exit(errors.length ? 1 : 0);
