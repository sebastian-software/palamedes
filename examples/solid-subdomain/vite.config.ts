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
  // The subdomain strategy serves each locale from its own host label
  // (`de.lvh.me`, `en.lvh.me`, …). Allow those hosts plus the deployed
  // preview domain for the dev/preview servers, and pin the demo port.
  server: {
    port: 4052,
    allowedHosts: [".lvh.me", ".examples.palamedes.dev"],
  },
  preview: {
    port: 4052,
    allowedHosts: [".lvh.me", ".examples.palamedes.dev"],
  },
})
