import { demoHosts, localeBootstrap } from "../shared-demo/vite.mjs";
import { palamedes } from "@palamedes/vite-plugin";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  preview: { allowedHosts: demoHosts("vue") },
  plugins: [localeBootstrap(), palamedes({ framework: "none", mdx: false }), vue()],
});
