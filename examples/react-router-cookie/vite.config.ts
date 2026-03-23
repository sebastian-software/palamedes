import { reactRouter } from "@react-router/dev/vite";
import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [palamedes(), reactRouter(), tsconfigPaths()],
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (
          warning.code === "SOURCEMAP_ERROR"
          && warning.message.includes("Can't resolve original location of error")
        ) {
          return
        }

        defaultHandler(warning)
      },
    },
  },
});
