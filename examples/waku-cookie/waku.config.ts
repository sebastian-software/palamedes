import react from "@vitejs/plugin-react"
import { defineConfig } from "waku/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  vite: {
    plugins: [
      palamedes(),
      react(),
    ],
  },
})
