import { reactRouter } from "@react-router/dev/vite";
import { palamedes } from "@palamedes/vite-plugin";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [palamedes(), reactRouter()],
  environments: { ssr: { resolve: { conditions: ["node", "module", "development|production"] } } },
});
