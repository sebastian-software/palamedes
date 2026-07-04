import { defineMessage } from "@palamedes/core/macro"
import type { MessageDescriptor, PalamedesI18n } from "@palamedes/core"
import { EVENT } from "@palamedes/example-ui"
import { ClientLocaleBoundary } from "@/components/ClientLocaleBoundary"
import { ClientReady } from "@/components/ClientReady"
import { LocaleSwitcher } from "@/components/LocaleSwitcher"
import { ProofPanel } from "@/components/ProofPanel"
import { SuggestionBanner } from "@/components/SuggestionBanner"
import { TicketPanel } from "@/components/TicketPanel"
import { createActiveServerI18n, getSubdomainLocale } from "@/lib/i18n.server"
import { getLocaleLabel, type Locale } from "@/lib/i18n"

// Server-rendered strings resolve through the concrete request-local i18n
// instance (see `translate` below). Direct `<Trans>`/`t` macros are reserved
// for the client components, where the client i18n scope is active; the RSC
// server scope is addressed explicitly here.
const eyebrowMessage = defineMessage({
  message: "Localized live with Palamedes",
}) as unknown as MessageDescriptor
const headlineMessage = defineMessage({
  message: "Book your seat at Frontend Stage 2026",
}) as unknown as MessageDescriptor
const greetMessage = defineMessage({
  message: "Welcome back, {attendeeName}.",
}) as unknown as MessageDescriptor
const ledeMessage = defineMessage({
  message: "Three days of talks on the craft of building for the web. Choose your tickets below.",
}) as unknown as MessageDescriptor
const renderedWithMessage = defineMessage({
  message: "Rendered with Next.js",
}) as unknown as MessageDescriptor
const serverLocaleMessage = defineMessage({
  message: "server locale",
}) as unknown as MessageDescriptor
const switchToRecommendedMessage = defineMessage({
  message: "Switch to the recommended locale",
}) as unknown as MessageDescriptor

function translate(
  i18n: PalamedesI18n,
  descriptor: MessageDescriptor,
  values?: Record<string, unknown>
): string {
  const id = descriptor.id ?? descriptor.message ?? ""
  return i18n._(id, values, descriptor)
}

export default async function SubdomainHome() {
  const { banner, host, locale } = await getSubdomainLocale()
  const { i18n } = await createActiveServerI18n(locale as Locale)
  const localeLabel = getLocaleLabel(locale)

  return (
    <main className="page-shell">
      {banner ? (
        <SuggestionBanner
          ctaLabel={translate(i18n, switchToRecommendedMessage)}
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
          {translate(i18n, eyebrowMessage)}
        </p>
        <h1>{translate(i18n, headlineMessage)}</h1>
        <p className="greet">
          {translate(i18n, greetMessage, { attendeeName: EVENT.attendeeName })}
        </p>
        <p className="lede">{translate(i18n, ledeMessage)}</p>
      </section>

      <ClientLocaleBoundary locale={locale}>
        <div className="grid">
          <TicketPanel locale={locale} />
          <ProofPanel locale={locale} />
        </div>
      </ClientLocaleBoundary>

      <footer className="foot">
        <span className="foot-badge">Palamedes</span>
        {translate(i18n, renderedWithMessage)}
        {" · "}
        {translate(i18n, serverLocaleMessage)}{" "}
        <strong data-testid="server-locale-value">{localeLabel}</strong>
      </footer>

      <ClientReady />
    </main>
  )
}
