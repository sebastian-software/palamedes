import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import type { LocaleBanner } from "@palamedes/example-locale-shared"
import { Counter } from "./Counter"
import { LocaleSwitcher } from "./LocaleSwitcher"
import { ServerFunctionProbe } from "./ServerFunctionProbe"
import { syncClientI18n, type Locale } from "../lib/i18n"

export function RouteLocalePage({
  banner,
  locale,
  localeLabel,
  renderedAt,
}: {
  banner: LocaleBanner | null
  locale: Locale
  localeLabel: string
  renderedAt: string
}) {
  syncClientI18n(locale)

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="kicker">TanStack Start</p>
        <h1>{t`Palamedes without framework-specific runtime wrappers.`}</h1>
        <p>
          <Trans>
            This example proves a route-based locale flow in TanStack Start with
            SSR, locale segments, host-mapping suggestions, .po imports, and
            localized server functions.
          </Trans>
        </p>
        {banner ? (
          <div className="panel" style={{ borderColor: "#d97706", background: "#fff7ed" }}>
            <p className="kicker">
              <Trans>Locale suggestion</Trans>
            </p>
            <p className="muted">{banner.description}</p>
            <a className="button" data-testid="locale-suggestion-cta" href={banner.recommendedUrl}>
              <Trans>Switch to the recommended locale</Trans>
            </a>
          </div>
        ) : null}
        <div className="button-row">
          <LocaleSwitcher locale={locale} />
        </div>
        <p className="footer-note">
          <Trans>Current locale:</Trans> <strong data-testid="server-locale-value">{localeLabel}</strong>
        </p>
      </section>

      <section className="grid cols-2">
        <section className="panel">
          <p className="kicker">
            <Trans>Server-rendered proof</Trans>
          </p>
          <h2>
            <Trans>SSR translation happens before the page reaches the browser.</Trans>
          </h2>
          <p className="muted">
            {t`This panel was rendered on the server for locale ${localeLabel}.`}
          </p>
          <div className="stats">
            <div>
              <span className="eyebrow">
                <Trans>Rendered on server</Trans>
              </span>
              <code>{renderedAt}</code>
            </div>
            <div>
              <span className="eyebrow">.po</span>
              <strong>
                <Trans>Loaded through the Palamedes Vite plugin</Trans>
              </strong>
            </div>
          </div>
        </section>

        <Counter locale={locale} />
        <ServerFunctionProbe locale={locale} />
      </section>
    </main>
  )
}
