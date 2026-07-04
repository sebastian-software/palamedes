import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [tanstackStart(), palamedes(), react()],
  preview: {
    // The tld strategy serves each locale from its own top-level domain; allow
    // the four test domains (apex plus framework subdomains) for the preview
    // server the browser verification drives.
    allowedHosts: [
      ".palamedes-i18n.com",
      ".palamedes-i18n.de",
      ".palamedes-i18n.es",
      ".palamedes-i18n.fr",
    ],
  },
  server: {
    allowedHosts: [
      ".palamedes-i18n.com",
      ".palamedes-i18n.de",
      ".palamedes-i18n.es",
      ".palamedes-i18n.fr",
    ],
  },
})
