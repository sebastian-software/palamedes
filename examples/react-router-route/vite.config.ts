import { reactRouter } from "@react-router/dev/vite"
import { palamedes } from "@palamedes/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [palamedes({ runtimeModule: "@palamedes/react/runtime" }), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "SOURCEMAP_ERROR" &&
          warning.message.includes("Can't resolve original location of error")
        ) {
          return
        }

        defaultHandler(warning)
      },
    },
  },
})
