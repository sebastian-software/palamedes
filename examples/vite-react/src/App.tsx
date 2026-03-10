import { useState } from "react"
import { t, plural } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { i18n } from "@lingui/core"
import { messages as enMessages } from "./locales/en.po"
import { messages as deMessages } from "./locales/de.po"
import { messages as esMessages } from "./locales/es.po"

const locales = {
  en: { name: "English", messages: enMessages },
  de: { name: "Deutsch", messages: deMessages },
  es: { name: "Español", messages: esMessages },
} as const

type Locale = keyof typeof locales

export function App() {
  const [count, setCount] = useState(0)
  const [locale, setLocale] = useState<Locale>("en")

  function handleLocaleChange(newLocale: Locale) {
    i18n.load(newLocale, locales[newLocale].messages)
    i18n.activate(newLocale)
    setLocale(newLocale)
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>
        <Trans>Welcome to Palamedes</Trans>
      </h1>

      <p style={{ color: "#666" }}>
        <Trans>
          This example demonstrates Lingui with the new OXC-based macro transformer.
          No Babel required!
        </Trans>
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2>{t`Language`}</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(Object.keys(locales) as Locale[]).map((loc) => (
            <button
              key={loc}
              onClick={() => handleLocaleChange(loc)}
              style={{
                padding: "0.5rem 1rem",
                background: locale === loc ? "#0066cc" : "#eee",
                color: locale === loc ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {locales[loc].name}
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>
          <Trans>Counter Example</Trans>
        </h2>
        <p>
          {plural(count, {
            one: "You clicked # time",
            other: "You clicked # times",
          })}
        </p>
        <button
          onClick={() => setCount((c) => c + 1)}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "1rem",
            background: "#0066cc",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          <Trans>Click me</Trans>
        </button>
      </section>

      <footer style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #eee", color: "#999", fontSize: "0.875rem" }}>
        <Trans>
          Powered by <code>@palamedes/vite-plugin</code>
        </Trans>
      </footer>
    </main>
  )
}
