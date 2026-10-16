import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  optimizeDeps: { exclude: ["@babylonjs/havok", "@recast-navigation/core", "@recast-navigation/wasm", "@recast-navigation/generators"] },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 8000,
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html") } },
  },
  server: { port: 5173, strictPort: true },
});
