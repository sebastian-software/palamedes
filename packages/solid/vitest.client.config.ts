import solid from "@solidjs/vite-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
})
