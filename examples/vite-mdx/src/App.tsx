import { useEffect, useState } from "react"

import Extraction from "./content/extraction.mdx"
import Runtime from "./content/runtime.mdx"
import Welcome from "./content/welcome.mdx"
import { activateLocale, type Locale } from "./i18n"

const pages = {
  extraction: Extraction,
  runtime: Runtime,
  welcome: Welcome,
} as const

type PageId = keyof typeof pages

function pageFromHash(): PageId {
  const page = window.location.hash.replace(/^#\/?/, "")
  return page in pages ? (page as PageId) : "welcome"
}

export function App() {
  const [locale, setLocale] = useState<Locale>("en")
  const [page, setPage] = useState<PageId>(pageFromHash)

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash())
    window.addEventListener("hashchange", handleHashChange)
    return () => window.removeEventListener("hashchange", handleHashChange)
  }, [])

  function switchLocale(nextLocale: Locale) {
    activateLocale(nextLocale)
    setLocale(nextLocale)
  }

  const Page = pages[page]

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/welcome">
          <span className="brand-mark">P</span>
          <span>Palamedes · MDX</span>
        </a>
        <div className="locale-switcher" role="group" aria-label="Language">
          <button
            aria-pressed={locale === "en"}
            data-testid="locale-switch-en"
            onClick={() => switchLocale("en")}
            type="button"
          >
            EN
          </button>
          <button
            aria-pressed={locale === "de"}
            data-testid="locale-switch-de"
            onClick={() => switchLocale("de")}
            type="button"
          >
            DE
          </button>
        </div>
      </header>

      <div className="layout">
        <aside>
          <p className="eyebrow">MDX handbook</p>
          <nav aria-label="Documentation">
            <a
              aria-current={page === "welcome" ? "page" : undefined}
              data-testid="page-link-welcome"
              href="#/welcome"
            >
              01 · Welcome
            </a>
            <a
              aria-current={page === "extraction" ? "page" : undefined}
              data-testid="page-link-extraction"
              href="#/extraction"
            >
              02 · Extraction
            </a>
            <a
              aria-current={page === "runtime" ? "page" : undefined}
              data-testid="page-link-runtime"
              href="#/runtime"
            >
              03 · Runtime
            </a>
          </nav>
          <p className="build-proof">
            Native extraction
            <br />
            Vite compilation
            <br />
            Reactive runtime
          </p>
        </aside>

        <main data-page={page} data-testid="mdx-page">
          <Page />
        </main>
      </div>
    </div>
  )
}
