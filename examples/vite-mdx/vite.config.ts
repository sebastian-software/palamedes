import react from "@vitejs/plugin-react";
import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [palamedes(), react()],
  preview: {
    allowedHosts: ["vite-mdx.examples.palamedes.dev"],
  },
});
