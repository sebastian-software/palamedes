import { defineConfig, type PluginOption } from "vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import solid from "@solidjs/vite-plugin";
import { palamedes } from "@palamedes/vite-plugin";
export default defineConfig({
  ssr: { noExternal: ["@palamedes/tanstack", "@palamedes/runtime", "@palamedes/vite-plugin"] },
  plugins: [
    tanstackStart({ router: { quoteStyle: "double", semicolons: true } }),
    palamedes({ framework: "solid" }) as PluginOption,
    solid({ ssr: true }),
  ],
});
