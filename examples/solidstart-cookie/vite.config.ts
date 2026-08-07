import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { solidStart } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [
    palamedes({ framework: "solid" }),
    solidStart({ middleware: "src/middleware.ts" }),
    nitro(),
  ],
})
