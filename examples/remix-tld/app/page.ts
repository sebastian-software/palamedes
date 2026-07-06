import { plural, t } from "@palamedes/core/macro"

import { LOCALES, LOCALE_LABELS, type Locale } from "./i18n.ts"

export type LocaleSwitchLink = {
  href?: string
  locale: Locale
}

export type RenderHomePageOptions = {
  banner?: string | null
  locale: string | undefined
  localeLabel: string
  strategyLabel?: string
  switchLinks?: LocaleSwitchLink[]
}

export function renderHomePage({
  banner,
  locale,
  localeLabel,
  strategyLabel = "cookie",
  switchLinks,
}: RenderHomePageOptions): string {
  const seatCount = 3
  const title = t`Remix v3 is rendering ${locale ?? "en"} with Palamedes`
  const seats = plural(seatCount, { one: "# seat left", other: "# seats left" })
  const description = t`This response was translated inside a request-scoped Remix handler.`
  const currentLocale = normalizePageLocale(locale)

  return `<!doctype html>
<html lang="${escapeHtml(currentLocale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 3rem; line-height: 1.5; }
      main { max-width: 42rem; }
      code { background: #eef2f7; border-radius: 4px; padding: 0.125rem 0.25rem; }
      form { display: inline; }
      nav { display: flex; gap: 0.5rem; margin: 1.5rem 0; }
      button { border: 1px solid #9ca3af; border-radius: 4px; background: #fff; padding: 0.375rem 0.75rem; }
      button[aria-pressed="true"] { background: #111827; border-color: #111827; color: #fff; }
    </style>
  </head>
  <body>
    <main>
      <p><code>@palamedes/remix</code></p>
      <p>Locale strategy: <strong>${escapeHtml(strategyLabel)}</strong></p>
      ${banner ? `<p role="status">${escapeHtml(banner)}</p>` : ""}
      <nav aria-label="Locale">${renderLocaleSwitcher(currentLocale, switchLinks)}</nav>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <p>${escapeHtml(seats)}</p>
      <p>Active locale: <strong>${escapeHtml(localeLabel)}</strong></p>
    </main>
  </body>
</html>`
}

function normalizePageLocale(locale: string | undefined): Locale {
  return LOCALES.includes(locale as Locale) ? (locale as Locale) : "en"
}

function renderLocaleSwitcher(
  currentLocale: Locale,
  switchLinks: LocaleSwitchLink[] | undefined
): string {
  const links: LocaleSwitchLink[] = switchLinks ?? LOCALES.map((locale) => ({ locale }))
  return links
    .map((item) => {
      const locale = item.locale
      const active = locale === currentLocale
      if (item.href) {
        return `<a aria-current="${active ? "page" : "false"}" href="${escapeHtml(item.href)}">
        ${escapeHtml(LOCALE_LABELS[locale])}
      </a>`
      }

      return `<form action="/locale" method="post">
        <button aria-pressed="${active}" name="locale" type="submit" value="${escapeHtml(locale)}">
          ${escapeHtml(LOCALE_LABELS[locale])}
        </button>
      </form>`
    })
    .join("")
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
