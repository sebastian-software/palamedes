import { defineConfig } from "@palamedes/config"

export default defineConfig({
  locales: ["en", "de", "es"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
})
