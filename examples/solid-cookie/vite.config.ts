import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { fileRoutes } from "filesystem-routing/vite";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  // These server helpers import a Vite virtual catalog module.
  ssr: { noExternal: ["@palamedes/runtime", "@palamedes/vite-plugin"] },
  plugins: [
    palamedes({ framework: "solid" }),
    solid({
      extensions: [".jsx", ".tsx"],
      serverFunctions: true,
      ssr: true,
      start: {
        middleware: "./src/middleware.ts",
        document: "./src/Document.tsx",
      },
    }),
    fileRoutes(),
    nitro(),
  ],
});
