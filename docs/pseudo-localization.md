# Pseudo-Localization And Fallback Locales

Palamedes supports two config options that are useful during adoption and UI
quality checks:

- `pseudoLocale` marks one locale as a generated pseudo-locale.
- `fallbackLocales` defines which locale chain is used when a message is
  missing in the active locale.

Both options live in `palamedes.config.ts`.

```ts
import { defineConfig } from "@palamedes/config"

export default defineConfig({
  locales: ["en", "de", "pseudo"],
  sourceLocale: "en",
  pseudoLocale: "pseudo",
  fallbackLocales: {
    de: ["en"],
    pseudo: ["en"],
  },
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
})
```

## `pseudoLocale`

Set `pseudoLocale` to the locale code you use for pseudo-localized UI testing.
The value must also appear in `locales`.

Palamedes treats the pseudo-locale as a development aid, not as a real
translation target. The Vite and Next.js plugin integrations pass the value
through to catalog compilation and skip `failOnMissing` failures for that
locale. That lets you keep strict missing-translation checks for real locales
while still running a generated pseudo-locale during layout testing.

Use it for checks such as:

- text expansion and truncation
- hardcoded strings that extraction missed
- layout assumptions around word length
- UI paths that are difficult to inspect in every real locale

Pseudo-localization does not replace real translation QA. It is an early signal
that the UI can tolerate translated text.

## `fallbackLocales`

Set `fallbackLocales` when a locale should fall back through one or more other
locales before Palamedes falls back to the source message.

The option accepts either one shared chain:

```ts
export default defineConfig({
  locales: ["en", "de", "fr"],
  sourceLocale: "en",
  fallbackLocales: ["en"],
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
})
```

or a per-locale map:

```ts
export default defineConfig({
  locales: ["en", "de-CH", "de", "fr"],
  sourceLocale: "en",
  fallbackLocales: {
    "de-CH": ["de", "en"],
    de: ["en"],
    fr: ["en"],
  },
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
})
```

The config loader removes a locale from its own fallback chain, so
`fallbackLocales: ["en"]` does not make `en` fall back to itself.

## Recommended Workflow

Keep production locales strict and use the pseudo-locale for local layout
testing:

1. Add a pseudo locale code to `locales`.
2. Set `pseudoLocale` to that code.
3. Keep `failOnMissing` enabled for real locales in the plugin.
4. Run `pmds audit --fail-on error` in CI.
5. Use the pseudo-locale in development routes, screenshots, or story fixtures
   to find layout problems before translators finish the real catalog.
