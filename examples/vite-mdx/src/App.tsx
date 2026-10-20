import { useEffect, useState } from "react";

import Extraction from "./content/extraction.mdx";
import Runtime from "./content/runtime.mdx";
import Welcome from "./content/welcome.mdx";
import { LOCALES, type Locale } from "./i18n";

const pages = {
  extraction: Extraction,
  runtime: Runtime,
  welcome: Welcome,
} as const;

type PageId = keyof typeof pages;

function pageFromHash(): PageId {
  const page = window.location.hash.replace(/^#\/?/, "");
  return page in pages ? (page as PageId) : "welcome";
}

function localeHref(locale: Locale): string {
  const url = new URL(window.location.href);
  url.searchParams.set("locale", locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function App({ locale }: { locale: Locale }) {
  const [page, setPage] = useState<PageId>(pageFromHash);

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const Page = pages[page];

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/welcome">
          <span className="brand-mark">P</span>
          <span>Palamedes · MDX</span>
        </a>
        <div className="locale-switcher" role="group" aria-label="Language">
          {LOCALES.map((choice) => (
            <a
              key={choice}
              aria-current={locale === choice ? "true" : undefined}
              data-testid={`locale-switch-${choice}`}
              href={localeHref(choice)}
            >
              {choice.toUpperCase()}
            </a>
          ))}
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
            Hook-free runtime
          </p>
        </aside>

        <main data-page={page} data-testid="mdx-page">
          <Page />
        </main>
      </div>
    </div>
  );
}
