import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import solid from "@solidjs/vite-plugin"
import { fileRoutes } from "filesystem-routing/vite"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  // Select Solid's component contract for compiled rich messages. Macro
  // lookups keep using the framework-neutral, hook-free runtime getter.
  plugins: [
    palamedes({ framework: "solid" }),
    solid({
      extensions: [".jsx", ".tsx"],
      serverFunctions: true,
      ssr: true,
      start: { middleware: "./src/middleware.ts" },
    }),
    fileRoutes(),
    nitro(),
  ],
  // The TLD strategy serves each locale from its own top-level domain
  // (`example.de`, `example.fr`, …). Allow those hosts plus the deployed
  // preview domain for the dev/preview servers, and pin the demo port.
  server: {
    port: 4053,
    allowedHosts: [
      ".palamedes-i18n.com",
      ".palamedes-i18n.de",
      ".palamedes-i18n.es",
      ".palamedes-i18n.fr",
    ],
  },
  preview: {
    port: 4053,
    allowedHosts: [
      ".palamedes-i18n.com",
      ".palamedes-i18n.de",
      ".palamedes-i18n.es",
      ".palamedes-i18n.fr",
    ],
  },
})
