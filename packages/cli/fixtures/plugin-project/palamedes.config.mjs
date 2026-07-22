export default {
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
  plugins: [["./example-plugin.mjs", { greeting: "hello" }]],
}
