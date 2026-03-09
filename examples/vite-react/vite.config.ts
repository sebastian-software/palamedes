import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { linguiOxc } from "@palamedes/vite"

export default defineConfig({
  plugins: [
    linguiOxc(),
    react(),
  ],
})
