import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/examples-browser/examples.browser.test.js"],
    testTimeout: 60_000,
  },
})
