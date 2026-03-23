import { defineMessage } from "@palamedes/core/macro"
import type { MessageDescriptor, PalamedesI18n } from "@palamedes/core"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { Counter } from "@/components/Counter"
import { ServerActionProbe } from "@/components/ServerActionProbe"
import { createActiveServerI18n } from "@/lib/i18n.server"
import { getLocaleLabel, LOCALES } from "@/lib/i18n"

const welcomeMessage = defineMessage({ message: "Welcome to Palamedes" }) as unknown as MessageDescriptor
const descriptionMessage = defineMessage({
  message: "This cookie-based Next.js example derives the first locale from Accept-Language, persists it in a cookie, and keeps server components plus server actions localized from the request state.",
}) as unknown as MessageDescriptor
const languageMessage = defineMessage({ message: "Language" }) as unknown as MessageDescriptor
const serverComponentProofMessage = defineMessage({ message: "Server Component Proof" }) as unknown as MessageDescriptor
const serverSectionMessage = defineMessage({ message: "This section was rendered on the server for locale {localeLabel}." }) as unknown as MessageDescriptor
const serverLocaleMessage = defineMessage({ message: "Server locale" }) as unknown as MessageDescriptor
const localeSourceMessage = defineMessage({ message: "Locale source" }) as unknown as MessageDescriptor
const cookieStrategyMessage = defineMessage({ message: "Cookie strategy" }) as unknown as MessageDescriptor
const cookieStrategyDescriptionMessage = defineMessage({
  message: "Without a locale cookie, the server picks the best supported language from Accept-Language. After switching, the cookie becomes authoritative.",
}) as unknown as MessageDescriptor
const renderedOnServerMessage = defineMessage({ message: "Rendered on server" }) as unknown as MessageDescriptor
const poweredByMessage = defineMessage({ message: "Powered by @palamedes/next-plugin" }) as unknown as MessageDescriptor

function translate(
  i18n: PalamedesI18n,
  descriptor: MessageDescriptor,
  values?: Record<string, unknown>
): string {
  const id = descriptor.id ?? descriptor.message ?? ""
  return i18n._(id, values, descriptor)
}

// This is a Server Component!
// Direct macros compile to getI18n()._() and resolve the active server instance.
// When the user changes language, router.refresh() is called,
// which causes the server to re-render with the new locale from the cookie.

export default async function Home() {
  const { i18n, locale, source } = await createActiveServerI18n()
  const localeLabel = getLocaleLabel(locale)
  const renderedAt = new Date().toISOString()

  return (
    <main style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>{translate(i18n, welcomeMessage)}</h1>

      <p style={{ color: "#666" }}>
        {translate(i18n, descriptionMessage)}
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2>{translate(i18n, languageMessage)}</h2>
        <LanguageSwitcher locale={locale} locales={LOCALES} />
        <p style={{ color: "#666" }}>
          {translate(i18n, cookieStrategyDescriptionMessage)}
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
        <h2>{translate(i18n, cookieStrategyMessage)}</h2>
        <p style={{ color: "#666" }}>
          {translate(i18n, cookieStrategyDescriptionMessage)}
        </p>
      </section>

      <Counter locale={locale} />
      <ServerActionProbe locale={locale} />

      {/* Footer rendered on server with direct macros / Trans */}
      <footer style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #eee", color: "#999", fontSize: "0.875rem" }}>
        {translate(i18n, poweredByMessage)}
      </footer>
    </main>
  )
}
