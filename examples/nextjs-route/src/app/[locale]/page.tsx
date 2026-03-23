import Link from "next/link"
import { defineMessage } from "@palamedes/core/macro"
import type { MessageDescriptor, PalamedesI18n } from "@palamedes/core"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { Counter } from "@/components/Counter"
import { ServerActionProbe } from "@/components/ServerActionProbe"
import { createActiveServerI18n, getRouteLocale } from "@/lib/i18n.server"
import { getLocaleLabel, LOCALES, type Locale } from "@/lib/i18n"

const welcomeMessage = defineMessage({ message: "Welcome to Palamedes" }) as unknown as MessageDescriptor
const descriptionMessage = defineMessage({
  message: "This route-based Next.js example keeps locale in the URL, derives mismatch hints from Accept-Language and host mapping, and still localizes server components plus server actions.",
}) as unknown as MessageDescriptor
const languageMessage = defineMessage({ message: "Language" }) as unknown as MessageDescriptor
const serverComponentProofMessage = defineMessage({ message: "Server Component Proof" }) as unknown as MessageDescriptor
const serverSectionMessage = defineMessage({ message: "This section was rendered on the server for locale {localeLabel}." }) as unknown as MessageDescriptor
const serverLocaleMessage = defineMessage({ message: "Server locale" }) as unknown as MessageDescriptor
const localeSourceMessage = defineMessage({ message: "Locale source" }) as unknown as MessageDescriptor
const routeStrategyMessage = defineMessage({ message: "Route strategy" }) as unknown as MessageDescriptor
const routeStrategyDescriptionMessage = defineMessage({
  message: "The locale segment in the URL is authoritative. If the host mapping or Accept-Language suggests another locale, the page shows a redirect recommendation instead of auto-switching.",
}) as unknown as MessageDescriptor
const renderedOnServerMessage = defineMessage({ message: "Rendered on server" }) as unknown as MessageDescriptor
const mismatchMessage = defineMessage({ message: "Locale suggestion" }) as unknown as MessageDescriptor
const mismatchActionMessage = defineMessage({ message: "Switch to the recommended locale" }) as unknown as MessageDescriptor
const poweredByMessage = defineMessage({ message: "Powered by @palamedes/next-plugin" }) as unknown as MessageDescriptor

function translate(
  i18n: PalamedesI18n,
  descriptor: MessageDescriptor,
  values?: Record<string, unknown>
): string {
  const id = descriptor.id ?? descriptor.message ?? ""
  return i18n._(id, values, descriptor)
}

export default async function RouteHome({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: rawLocale } = await params
  const { banner, locale, source } = await getRouteLocale(rawLocale)
  const { i18n } = await createActiveServerI18n(locale as Locale)
  const localeLabel = getLocaleLabel(locale)
  const renderedAt = new Date().toISOString()

  return (
    <main style={{ padding: "2rem", maxWidth: "700px", margin: "0 auto" }}>
      <h1>{translate(i18n, welcomeMessage)}</h1>

      <p style={{ color: "#666" }}>
        {translate(i18n, descriptionMessage)}
      </p>

      {banner ? (
        <section
          style={{
            marginTop: "1.5rem",
            border: "1px solid #d97706",
            background: "#fff7ed",
            borderRadius: "8px",
            padding: "1rem",
          }}
        >
          <h2 style={{ marginTop: 0 }}>{translate(i18n, mismatchMessage)}</h2>
          <p style={{ color: "#7c2d12" }}>{banner.description}</p>
          <Link
            data-testid="locale-suggestion-cta"
            href={banner.recommendedUrl}
            style={{ color: "#9a3412", fontWeight: 700 }}
          >
            {translate(i18n, mismatchActionMessage)}
          </Link>
        </section>
      ) : null}

      <section style={{ marginTop: "2rem" }}>
        <h2>{translate(i18n, languageMessage)}</h2>
        <LanguageSwitcher locale={locale} locales={LOCALES} />
        <p style={{ color: "#666" }}>
          {translate(i18n, routeStrategyDescriptionMessage)}
        </p>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>{translate(i18n, serverComponentProofMessage)}</h2>
        <p style={{ color: "#666" }}>
          {translate(i18n, serverSectionMessage, { localeLabel })}
        </p>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 12rem) minmax(0, 1fr)",
            gap: "0.5rem 1rem",
          }}
        >
          <dt>{translate(i18n, serverLocaleMessage)}</dt>
          <dd data-testid="server-locale-value" style={{ margin: 0 }}>{localeLabel}</dd>
          <dt>{translate(i18n, localeSourceMessage)}</dt>
          <dd style={{ margin: 0 }}>{source}</dd>
          <dt>{translate(i18n, renderedOnServerMessage)}</dt>
          <dd style={{ margin: 0 }}>
            <code>{renderedAt}</code>
          </dd>
        </dl>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>{translate(i18n, routeStrategyMessage)}</h2>
        <p style={{ color: "#666" }}>
          {translate(i18n, routeStrategyDescriptionMessage)}
        </p>
      </section>

      <Counter locale={locale} />
      <ServerActionProbe locale={locale} />

      <footer style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #eee", color: "#999", fontSize: "0.875rem" }}>
        {translate(i18n, poweredByMessage)}
      </footer>
    </main>
  )
}
