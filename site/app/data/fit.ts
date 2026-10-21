/* The cases where the answer is "use something else", stated plainly. */
export const NOT_FOR_YOU = [
  {
    case: "You need a stable Vue adapter, Angular, or Svelte",
    answer:
      "React and Solid have established integrations. Vue + Vite and Nuxt 4 have separate experimental browser and Node SSR proofs, with no published Vue or Nuxt adapter package. Angular and Svelte remain unsupported. Check the preview boundaries before choosing either Vue path.",
  },
  {
    case: "You ship React Native",
    answer:
      "There is no React Native adapter here. fbtee has an explicit Expo path, while Lingui and i18next also support React Native today.",
  },
  {
    case: "Kilobytes are your hard constraint",
    answer:
      "Paraglide's zero-runtime compilation beats a runtime layer on bundle size by construction. If that is the number you are judged on, start there.",
  },
  {
    case: "You want the i18n library to own routing",
    answer:
      "next-intl treats localized pathnames and domain routing as core product. Palamedes leaves URLs to your router on purpose.",
  },
];
