import { defineConfig } from "vitest/config";

// The unit tests cover plain server modules, so they skip the TanStack Start
// and Palamedes Vite plugins that vite.config.ts loads for the app.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
