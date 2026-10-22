/* The cases where the answer is "use something else", stated plainly. */
export const NOT_FOR_YOU = [
  {
    case: "You build with Angular",
    answer:
      "There is no Angular adapter here. React, Solid, Remix, Vue, and Svelte have working integration examples; the framework guides describe the setup for each host.",
  },
  {
    case: "You ship React Native",
    answer:
      "There is no React Native adapter here. fbtee has an explicit Expo path, while Lingui and i18next also support React Native today.",
  },
  {
    case: "You require no browser i18n runtime",
    answer:
      "Palamedes uses a runtime when translated components execute in the browser. If your architecture requires zero client i18n JavaScript, keep translation on the server or choose a compilation model that removes the runtime entirely.",
  },
  {
    case: "You want the i18n library to own routing",
    answer:
      "next-intl treats localized pathnames and domain routing as core product. Palamedes leaves URLs to your router on purpose.",
  },
];
