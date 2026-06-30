import { createFileRoute } from "@tanstack/react-router"
import { t } from "@palamedes/core/macro"
import { useClientLocale } from "@palamedes/react/client"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import { ClientReady } from "../components/ClientReady"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ProofPanel } from "../components/ProofPanel"
import { TicketPanel } from "../components/TicketPanel"
import { syncClientI18n } from "../lib/i18n"
import { loadHomePageData } from "../lib/server-functions"

export const Route = createFileRoute("/")({
  loader: () => loadHomePageData(),
  component: Home,
})

function Home() {
  const { locale, localeLabel } = Route.useLoaderData()
  useClientLocale(locale, syncClientI18n)

  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand">
          <b>Frontend Stage</b>
          <span className="brand-meta">Berlin · 2026</span>
        </div>
        <LocaleSwitcher locale={locale} />
      </header>

      <section className="hero">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          <Trans>Localized live with Palamedes</Trans>
        </p>
        <h1>
          <Trans>Book your seat at Frontend Stage 2026</Trans>
        </h1>
        <p className="greet">{t`Welcome back, ${EVENT.attendeeName}.`}</p>
        <p className="lede">
          <Trans>
            Three days of talks on the craft of building for the web. Choose your tickets below.
          </Trans>
        </p>
      </section>

      <div className="grid">
        <TicketPanel locale={locale} />
        <ProofPanel locale={locale} />
      </div>

      <footer className="foot">
        <span className="foot-badge">Palamedes</span>
        <Trans>Rendered with TanStack Start</Trans>
        {" · "}
        <Trans>server locale</Trans>{" "}
        <strong data-testid="server-locale-value">{localeLabel}</strong>
      </footer>

      <ClientReady />
    </main>
  )
}
