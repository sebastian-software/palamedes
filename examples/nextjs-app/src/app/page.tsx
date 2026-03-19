import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { Counter } from "@/components/Counter"
import { getLocale } from "@/lib/i18n.server"
import { LOCALES } from "@/lib/i18n"

// This is a Server Component!
// Direct macros compile to getI18n()._() and resolve the active server instance.
// When the user changes language, router.refresh() is called,
// which causes the server to re-render with the new locale from the cookie.

export default async function Home() {
  const locale = await getLocale()

  return (
    <main style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>{t`Welcome to Palamedes`}</h1>

      <p style={{ color: "#666" }}>
        {t`This example demonstrates the Palamedes-owned runtime with the OXC-based macro transformer in a Next.js App Router project. No Babel required!`}
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2>{t`Language`}</h2>
        <LanguageSwitcher locale={locale} locales={LOCALES} />
      </section>

      <Counter locale={locale} />

      {/* Footer rendered on server with direct macros / Trans */}
      <footer style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #eee", color: "#999", fontSize: "0.875rem" }}>
        <Trans>
          Powered by <code>@palamedes/next-plugin</code>
        </Trans>
      </footer>
    </main>
  )
}
