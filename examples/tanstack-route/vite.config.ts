import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [
    tanstackStart(),
    palamedes(),
    react(),
  ],
  preview: {
    allowedHosts: ["de.lvh.me", "en.lvh.me", "es.lvh.me"],
  },
  server: {
    allowedHosts: ["de.lvh.me", "en.lvh.me", "es.lvh.me"],
  },
})
