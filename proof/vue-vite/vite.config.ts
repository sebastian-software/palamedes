import { palamedes } from "@palamedes/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [palamedes({ framework: "none", mdx: false }), vue()],
});
