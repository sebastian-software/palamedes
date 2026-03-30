import { defineConfig } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  vite: {
    plugins: [palamedes()],
  },
})
