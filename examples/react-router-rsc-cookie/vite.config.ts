import { unstable_reactRouterRSC as reactRouterRSC } from "@react-router/dev/vite"
import { palamedes } from "@palamedes/vite-plugin"
import rsc from "@vitejs/plugin-rsc"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [palamedes(), reactRouterRSC(), rsc()],
  resolve: {
    tsconfigPaths: true,
  },
})
