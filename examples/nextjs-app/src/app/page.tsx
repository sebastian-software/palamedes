import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { Counter } from "@/components/Counter"
import { initI18nServer } from "@/lib/i18n.server"

// This is a Server Component!
// Direct macros compile to getI18n()._() and resolve the active server instance.
// When the user changes language, router.refresh() is called,
// which causes the server to re-render with the new locale from the cookie.

export default async function Home() {
  // Initialize i18n before using translations
  await initI18nServer()

  return (
    <main style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>{t`Welcome to Palamedes`}</h1>

      <p style={{ color: "#666" }}>
        {t`This example demonstrates Lingui with the new OXC-based macro transformer in a Next.js App Router project. No Babel required!`}
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2>{t`Language`}</h2>
        <LanguageSwitcher />
      </section>

      {/* Counter is a Client Component - it still uses direct macros. */}
      <Counter />

      {/* Footer rendered on server with direct macros / Trans */}
      <footer style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #eee", color: "#999", fontSize: "0.875rem" }}>
        <Trans>
          Powered by <code>@lingui/next-lingui-oxc</code>
        </Trans>
      </footer>
    </main>
  )
}
