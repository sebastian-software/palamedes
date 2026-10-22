import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { palamedesSvelteKit } from "./integration/vite.ts";

export default defineConfig({
  plugins: [palamedesSvelteKit(), sveltekit({ adapter: adapter(), paths: { relative: false } })],
});
