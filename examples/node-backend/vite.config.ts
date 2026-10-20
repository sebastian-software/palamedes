import path from "node:path";
import { fileURLToPath } from "node:url";
import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig, type Plugin } from "vite";

const src = fileURLToPath(new URL("src/", import.meta.url));

/**
 * Application code imports `./i18n.ts`, the unbundled runtime-macro variant.
 * The bundle uses the Vite catalog store instead, so only that import from a
 * module directly in src/ is redirected; every other `./i18n.ts` is untouched.
 */
function viteI18n(): Plugin {
  return {
    name: "node-backend-vite-i18n",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "./i18n.ts" || !importer) return null;
      // resolve() also normalizes Vite's forward-slash ids on Windows.
      return path.resolve(path.dirname(importer)) === path.resolve(src)
        ? path.join(src, "i18n.vite.ts")
        : null;
    },
  };
}

export default defineConfig({
  plugins: [viteI18n(), palamedes({ framework: "none" })],
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
