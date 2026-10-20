import { EVENT } from "@palamedes/example-ui";
import { t } from "@palamedes/core/macro";

import { LOCALES, type Locale } from "./i18n.ts";

export type LocaleSwitchLink = {
  href?: string;
  locale: Locale;
};

export type RenderHomePageOptions = {
  banner?: string | null;
  locale: string | undefined;
  localeLabel: string;
  hasLocaleChoice?: boolean;
  clientCatalog?: string;
  clientProof?: string;
  clientEntry?: string;
  framesHref?: string;
  switchLinks?: LocaleSwitchLink[];
};

export function renderHomePage({
  banner,
  locale,
  localeLabel,
  hasLocaleChoice = false,
  clientCatalog,
  clientProof,
  clientEntry,
  framesHref = "/frames",
  switchLinks,
}: RenderHomePageOptions): string {
  const title = t`Book your seat at Frontend Stage 2026`;
  const eyebrow = t`Localized for this document with Palamedes`;
  const greeting = t`Welcome back, ${EVENT.attendeeName}.`;
  const description = t`Three days of talks on the craft of building for the web. Choose your tickets below.`;
  const renderedWith = t`Rendered with Remix`;
  const serverLocale = t`server locale`;
  const localeControlLabel = t`Locale`;
  const currentLocale = normalizePageLocale(locale);

  return `<!doctype html>
<html lang="${escapeHtml(currentLocale)}" data-palamedes-time-zone="Europe/Berlin">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/demo.css" />
  </head>
  <body>
    <main class="page-shell">
      ${banner ? `<p class="notice" role="status">${escapeHtml(banner)}</p>` : ""}
      <header class="topbar">
        <div class="brand"><b>Frontend Stage</b><span class="brand-meta">Berlin · 2026</span></div>
        <nav class="switcher" aria-label="Locale"><span class="switcher-label">${escapeHtml(localeControlLabel)}</span><div class="seg" role="group" aria-label="Language">${renderLocaleSwitcher(currentLocale, switchLinks, hasLocaleChoice)}</div></nav>
      </header>
      <section class="hero">
        <p class="eyebrow"><span class="dot" aria-hidden="true"></span>${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="greet">${escapeHtml(greeting)}</p>
        <p class="lede">${escapeHtml(description)}</p>
      </section>
      ${clientProof ? `<div data-remix-client-proof data-remix-locale="${escapeHtml(currentLocale)}" data-remix-frames-href="${escapeHtml(framesHref)}">${clientProof}</div>` : ""}
      <footer class="foot"><span class="foot-badge">Palamedes</span>${escapeHtml(renderedWith)} · ${escapeHtml(serverLocale)} <strong data-testid="server-locale-value">${escapeHtml(localeLabel)}</strong></footer>
    </main>
    ${clientCatalog ?? ""}
    ${clientEntry ?? ""}
  </body>
</html>`;
}

function normalizePageLocale(locale: string | undefined): Locale {
  return LOCALES.includes(locale as Locale) ? (locale as Locale) : "en";
}

function renderLocaleSwitcher(
  currentLocale: Locale,
  switchLinks: LocaleSwitchLink[] | undefined,
  hasLocaleChoice: boolean,
): string {
  const links: LocaleSwitchLink[] = switchLinks ?? LOCALES.map((locale) => ({ locale }));
  return links
    .map((item) => {
      const locale = item.locale;
      const active = locale === currentLocale;
      if (item.href) {
        return `<a data-testid="locale-switch-${escapeHtml(locale)}" aria-current="${active ? "page" : "false"}" href="${escapeHtml(item.href)}">
        ${escapeHtml(locale.toUpperCase())}
      </a>`;
      }

      return `<form style="display:contents" action="/locale" method="post">
        <button aria-pressed="${active}" data-testid="locale-switch-${escapeHtml(locale)}" ${active && hasLocaleChoice ? "disabled" : ""} name="locale" type="submit" value="${escapeHtml(locale)}">
          ${escapeHtml(locale.toUpperCase())}
        </button>
      </form>`;
    })
    .join("");
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
