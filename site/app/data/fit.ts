/* The cases where the answer is "use something else", stated plainly. */
export const NOT_FOR_YOU = [
  {
    case: "You build with Vue, Angular, or Svelte",
    answer:
      "Palamedes ships React and Solid packages only. Lingui covers Vue, i18next covers nearly everything, and vue-i18n is the idiomatic choice inside the Vue ecosystem.",
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
