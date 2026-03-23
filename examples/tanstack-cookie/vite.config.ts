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
})
