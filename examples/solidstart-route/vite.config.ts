import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { solidStart } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  // Select Solid's component contract for compiled rich messages. Macro
  // lookups keep using the framework-neutral, hook-free runtime getter.
  plugins: [palamedes({ framework: "solid" }), solidStart(), nitro()],
})
