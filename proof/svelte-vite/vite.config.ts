import { demoHosts, localeBootstrap } from "../shared-demo/vite.mjs";
import { palamedes } from "@palamedes/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  preview: { allowedHosts: demoHosts("svelte") },
  plugins: [localeBootstrap(), palamedes({ framework: "none", mdx: false }), svelte()],
});
