// Bakes public/assets/env/*.hdr → .env (prefiltered IBL) using headless Chromium + Vite dev server.
import { chromium } from "playwright";
import { createServer } from "vite";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root: ROOT, server: { port: 5287, strictPort: false }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await mkdir(join(ROOT, "public/assets/env"), { recursive: true });
for (const f of await readdir(join(ROOT, "assets-src/hdri"))) {
  if (!f.endsWith(".hdr")) continue;
  await page.goto(`${server.resolvedUrls.local[0].replace(/\/$/, "")}/tools/bake-env.html?src=/assets-src/hdri/${f}&size=512`);
  await page.waitForFunction(() => window.envBase64, null, { timeout: 120000 });
  const b64 = await page.evaluate(() => window.envBase64);
  const out = join(ROOT, "public/assets/env", f.replace(".hdr", ".env"));
  await writeFile(out, Buffer.from(b64, "base64"));
  console.log("baked", out, (b64.length * 0.75 / 1024).toFixed(0), "KB");
}
await browser.close();
await server.close();
