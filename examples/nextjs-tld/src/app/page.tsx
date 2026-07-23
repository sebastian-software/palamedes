import { t } from "@palamedes/core/macro"
import { EVENT } from "@palamedes/example-ui"
import { ClientLocaleBoundary } from "@/components/ClientLocaleBoundary"
import { ClientReady } from "@/components/ClientReady"
import { LocaleSwitcher } from "@/components/LocaleSwitcher"
import { ProofPanel } from "@/components/ProofPanel"
import { SuggestionBanner } from "@/components/SuggestionBanner"
import { TicketPanel } from "@/components/TicketPanel"
import { createActiveServerI18n, getTldLocale } from "@/lib/i18n.server"
import { getLocaleLabel, type Locale } from "@/lib/i18n"

// These functions run only after `createActiveServerI18n()` activated the
// request-local runtime scope.
function translateEyebrow(): string {
  return t`Localized live with Palamedes`
}

function translateHeadline(): string {
  return t`Book your seat at Frontend Stage 2026`
}

function translateGreeting(attendeeName: string): string {
  return t`Welcome back, ${attendeeName}.`
}

function translateLede(): string {
  return t`Three days of talks on the craft of building for the web. Choose your tickets below.`
}

function translateRenderedWith(): string {
  return t`Rendered with Next.js`
}

function translateServerLocale(): string {
  return t`server locale`
}

function translateSwitchToRecommended(): string {
  return t`Switch to the recommended locale`
}

export default async function TldHome() {
  const { banner, host, locale } = await getTldLocale()
  await createActiveServerI18n(locale as Locale)
  const localeLabel = getLocaleLabel(locale)

  return (
    <main className="page-shell">
      {banner ? (
        <SuggestionBanner
          ctaLabel={translateSwitchToRecommended()}
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
        <ClientLocaleBoundary locale={locale}>
          <LocaleSwitcher host={host} locale={locale} />
        </ClientLocaleBoundary>
      </header>

      <section className="hero">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          {translateEyebrow()}
        </p>
        <h1>{translateHeadline()}</h1>
        <p className="greet">{translateGreeting(EVENT.attendeeName)}</p>
        <p className="lede">{translateLede()}</p>
      </section>

      <ClientLocaleBoundary locale={locale}>
        <div className="grid">
          <TicketPanel locale={locale} />
          <ProofPanel locale={locale} />
        </div>
      </ClientLocaleBoundary>

      <footer className="foot">
        <span className="foot-badge">Palamedes</span>
        {translateRenderedWith()}
        {" · "}
        {translateServerLocale()} <strong data-testid="server-locale-value">{localeLabel}</strong>
      </footer>

      <ClientReady />
    </main>
  )
}
