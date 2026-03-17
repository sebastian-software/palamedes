export default {
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src/**/*.{ts,tsx}"],
    },
  ],
}
