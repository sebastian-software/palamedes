import Link from "next/link"
import { defineMessage } from "@palamedes/core/macro"
import type { MessageDescriptor, PalamedesI18n } from "@palamedes/core"
import { EVENT } from "@palamedes/example-ui"
import { ClientLocaleBoundary } from "@/components/ClientLocaleBoundary"
import { ClientReady } from "@/components/ClientReady"
import { LocaleSwitcher } from "@/components/LocaleSwitcher"
import { ProofPanel } from "@/components/ProofPanel"
import { TicketPanel } from "@/components/TicketPanel"
import { createActiveServerI18n, getRouteLocale } from "@/lib/i18n.server"
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

export default async function RouteHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params
  const { banner, locale } = await getRouteLocale(rawLocale)
  const { i18n } = await createActiveServerI18n(locale as Locale)
  const localeLabel = getLocaleLabel(locale)

  return (
    <main className="page-shell">
      {banner ? (
        <div className="notice" role="status">
          <span className="notice-text">{banner.description}</span>
          <Link
            className="notice-cta"
            data-testid="locale-suggestion-cta"
            href={banner.recommendedUrl}
          >
            {translate(i18n, switchToRecommendedMessage)}
          </Link>
        </div>
      ) : null}

      <header className="topbar">
        <div className="brand">
          <b>Frontend Stage</b>
          <span className="brand-meta">Berlin · 2026</span>
        </div>
        <ClientLocaleBoundary locale={locale}>
          <LocaleSwitcher locale={locale} />
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
