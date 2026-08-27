import solid from "@solidjs/vite-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "src/client.test.tsx"],
    globals: true,
  },
})
