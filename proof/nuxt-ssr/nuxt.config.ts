export default defineNuxtConfig({
  compatibilityDate: "2026-10-21",
  devtools: { enabled: false },
  telemetry: false,
  modules: ["./modules/palamedes/module.mjs"],
  css: ["@palamedes/example-ui/styles.css"],
  nitro: { preset: "node-server" },
  typescript: {
    tsConfig: {
      compilerOptions: { paths: { vite: ["../node_modules/vite/dist/node/index.d.ts"] } },
    },
  },
});
