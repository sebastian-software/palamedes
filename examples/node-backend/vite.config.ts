import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [palamedes({ framework: "none" })],
  // Bundle Express, Hono, and the Palamedes runtime so dist/ runs on its own.
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: "node22",
    rolldownOptions: {
      input: { cli: "src/cli.ts", express: "src/express-server.ts", hono: "src/hono-server.ts" },
      output: { entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
    },
  },
});
