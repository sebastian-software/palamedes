import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "tsdown";

// tsdown runs Rolldown without Vite environments, so the server target is explicit.
export default defineConfig({
  entry: { cli: "src/cli.ts", express: "src/express-server.ts", hono: "src/hono-server.ts" },
  outDir: "dist-tsdown",
  platform: "node",
  target: "node24.3",
  sourcemap: true,
  plugins: [palamedes({ framework: "none", environment: "server" })],
  // Bundle Express, Hono, and the Palamedes runtime so the output runs on its own.
  deps: { alwaysBundle: [/./u], onlyBundle: false },
  outputOptions: { chunkFileNames: "chunks/[name]-[hash].mjs" },
});
