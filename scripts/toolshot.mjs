// Screenshot a dev tool page: node scripts/toolshot.mjs <tools/page.html> "<query>" <out.png> [w] [h]
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [page_, query = "", out = "screenshots/_tmp/tool.png", w = "1400", h = "800"] = process.argv.slice(2);
const server = await createServer({ root: ROOT, server: { port: 5293, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || /warn/.test(m.type())) && errors.push(m.type() + ": " + m.text().slice(0, 200)));
await page.goto(`${server.resolvedUrls.local[0]}${page_}?${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch((e) => errors.push("timeout " + e.message));
await page.screenshot({ path: out });
await browser.close();
await server.close();
console.log(errors.length ? errors.slice(0, 12).join("\n") : "ok");
