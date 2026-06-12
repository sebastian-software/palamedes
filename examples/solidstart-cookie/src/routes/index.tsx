import { Show } from "solid-js"
import { createAsync } from "@solidjs/router"
import { t } from "@palamedes/core/macro"
import { createClientLocaleEffect } from "@palamedes/solid/client"
import { Trans } from "@palamedes/solid/macro"
import { ClientReady } from "../components/ClientReady"
import { Counter } from "../components/Counter"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ServerQueryProbe } from "../components/ServerQueryProbe"
import { syncClientI18n } from "../lib/i18n"
import { loadHomePageData } from "../lib/server"

type HomePageData = {
  locale: "en" | "de" | "es"
  localeLabel: string
  renderedAt: string
  source: string
}

function HomePageContent(props: { data: HomePageData }) {
  createClientLocaleEffect(() => props.data.locale, syncClientI18n)

  return (
    <main class="page-shell">
      <ClientReady />

      <section class="hero">
        <p class="kicker">SolidStart</p>
        <h1>{t`Palamedes in SolidStart with one runtime model.`}</h1>
        <p>
          <Trans>
            This example proves a cookie-based locale flow in SolidStart with SSR, first-request
            Accept-Language detection, cookie persistence, .po imports, and localized server
            queries.
          </Trans>
        </p>
        <div class="button-row">
          <LocaleSwitcher locale={props.data.locale} />
        </div>
        <p class="footer-note">
          <Trans>Current locale:</Trans>{" "}
          <strong data-testid="server-locale-value">{props.data.localeLabel}</strong>
        </p>
      </section>

      <section class="grid cols-2">
        <section class="panel">
          <p class="kicker">
            <Trans>Server-rendered proof</Trans>
          </p>
          <h2>
            <Trans>SSR translation happens before the page reaches the browser.</Trans>
          </h2>
          <p class="muted">
            {t`This panel was rendered on the server for locale ${props.data.localeLabel}.`}
          </p>
          <div class="stats">
            <div>
              <span class="eyebrow">
                <Trans>Locale source</Trans>
              </span>
              <strong>{props.data.source}</strong>
            </div>
            <div>
              <span class="eyebrow">
                <Trans>Rendered on server</Trans>
              </span>
              <code>{props.data.renderedAt}</code>
            </div>
          </div>
        </section>

        <Counter locale={props.data.locale} />
        <ServerQueryProbe locale={props.data.locale} />
      </section>
    </main>
  )
}

export default function HomePage() {
  const pageData = createAsync(() => loadHomePageData())

  return (
    <Show when={pageData()}>
      {(page) => {
        const data = page()
        return <HomePageContent data={data} />
      }}
    </Show>
  )
}
