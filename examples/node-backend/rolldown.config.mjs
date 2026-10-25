import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "rolldown";

export default defineConfig({
  input: { cli: "src/cli.ts", express: "src/express-server.ts", hono: "src/hono-server.ts" },
  platform: "node",
  plugins: [palamedes({ framework: "none", environment: "server" })],
  output: {
    dir: "dist-rolldown",
    format: "esm",
    entryFileNames: "[name].mjs",
    chunkFileNames: "chunks/[name]-[hash].mjs",
    sourcemap: true,
  },
});
