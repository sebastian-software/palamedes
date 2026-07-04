import { t } from "@palamedes/core/macro"
import { useClientLocale } from "@palamedes/react/client"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import type { LocaleSuggestion } from "@palamedes/core/locale"
import { ClientReady } from "./ClientReady"
import { LocaleSwitcher } from "./LocaleSwitcher"
import { ProofPanel } from "./ProofPanel"
import { SuggestionBanner } from "./SuggestionBanner"
import { TicketPanel } from "./TicketPanel"
import { syncClientI18n, type Locale } from "../lib/i18n"

export function RouteLocalePage({
  banner,
  host,
  locale,
  localeLabel,
}: {
  banner: LocaleSuggestion<Locale> | null
  host: string | null
  locale: Locale
  localeLabel: string
  renderedAt: string
}) {
  useClientLocale(locale, syncClientI18n)

  return (
    <main className="page-shell">
      {banner ? (
        <SuggestionBanner
          currentLocale={locale}
          description={banner.description}
          recommendedLocale={banner.recommendedLocale}
          recommendedUrl={banner.recommendedUrl}
        />
      ) : null}

      <header className="topbar">
        <div className="brand">
          <b>Frontend Stage</b>
          <span className="brand-meta">Berlin · 2026</span>
        </div>
        <LocaleSwitcher host={host} locale={locale} />
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
