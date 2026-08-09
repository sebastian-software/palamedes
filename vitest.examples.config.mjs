import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/examples-browser/examples.browser.test.js"],
    retry: process.env.PALAMEDES_BROWSER_RETRY === "1" ? 1 : 0,
    testTimeout: 60_000,
  },
})
