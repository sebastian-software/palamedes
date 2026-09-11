import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { palamedes } from "@palamedes/vite-plugin";

const nativeProductionEntries =
  process.env.NODE_ENV === "production"
    ? {
        entryServer: "./src/entry-server-csp.tsx",
        entryClient: "./src/entry-client-csp.tsx",
      }
    : {};

export default defineConfig({
  plugins: [
    palamedes({ framework: "solid" }),
    solid({
      extensions: [".jsx", ".tsx"],
      serverFunctions: true,
      ssr: true,
      start: {
        middleware: "./src/middleware.ts",
        document: "./src/Document.tsx",
        ...nativeProductionEntries,
      },
    }),
    fileRoutes(),
    nitro(),
  ],
});
