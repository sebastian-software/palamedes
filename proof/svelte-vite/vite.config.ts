import { palamedes } from "@palamedes/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [palamedes({ framework: "none", mdx: false }), svelte()],
});
