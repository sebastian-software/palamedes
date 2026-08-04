import { defineConfig } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  vite: {
    // Select Solid's component contract for compiled rich messages. Macro
    // lookups keep using the framework-neutral, hook-free runtime getter.
    plugins: [palamedes({ framework: "solid" })],
  },
})
