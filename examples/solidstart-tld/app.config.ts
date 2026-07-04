import { defineConfig } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  vite: {
    // Point the macro transform at Solid's reactive `getI18n` so `t`/`plural`
    // output follows client-side locale switches, matching the `<Trans>` runtime.
    plugins: [palamedes({ runtimeModule: "@palamedes/solid/runtime" })],
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
  },
})
