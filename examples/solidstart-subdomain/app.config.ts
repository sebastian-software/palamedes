import { defineConfig } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  vite: {
    // Point the macro transform at Solid's reactive `getI18n` so `t`/`plural`
    // output follows client-side locale switches, matching the `<Trans>` runtime.
    plugins: [palamedes({ runtimeModule: "@palamedes/solid/runtime" })],
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
  },
})
