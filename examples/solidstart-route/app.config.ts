import { defineConfig } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  vite: {
    // Point the macro transform at Solid's reactive `getI18n` so `t`/`plural`
    // output follows client-side locale switches, matching the `<Trans>` runtime.
    plugins: [palamedes({ runtimeModule: "@palamedes/solid/runtime" })],
  },
})
