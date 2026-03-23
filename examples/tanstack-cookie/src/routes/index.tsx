import { createFileRoute } from "@tanstack/react-router"
import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { Counter } from "../components/Counter"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ServerFunctionProbe } from "../components/ServerFunctionProbe"
import { syncClientI18n } from "../lib/i18n"
import { loadHomePageData } from "../lib/server-functions"

export const Route = createFileRoute("/")({
  loader: () => loadHomePageData(),
  component: Home,
})

function Home() {
  const { locale, localeLabel, renderedAt, source } = Route.useLoaderData()
  syncClientI18n(locale)

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="kicker">TanStack Start</p>
        <h1>{t`Palamedes without framework-specific runtime wrappers.`}</h1>
        <p>
          <Trans>
            This example proves a cookie-based locale flow in TanStack Start:
            first-request Accept-Language detection, cookie persistence, SSR,
            .po imports, and localized server functions.
          </Trans>
        </p>
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
                <Trans>Locale source</Trans>
              </span>
              <strong>{source}</strong>
            </div>
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

        <section className="panel">
          <p className="kicker">
            <Trans>What this proves</Trans>
          </p>
          <h2>
            <Trans>No Lingui-owned runtime package is required here.</Trans>
          </h2>
          <ul className="muted">
            <li>
              <Trans>Macros come from @palamedes/core/macro and @palamedes/react/macro.</Trans>
            </li>
            <li>
              <Trans>SSR uses a request-local i18n instance via setServerI18nGetter().</Trans>
            </li>
            <li>
              <Trans>Client interactions reuse the same provider-free runtime model.</Trans>
            </li>
          </ul>
        </section>
      </section>
    </main>
  )
}
