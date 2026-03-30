import { Show } from "solid-js"
import { createAsync, useParams } from "@solidjs/router"
import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/solid/macro"
import { ClientReady } from "../components/ClientReady"
import { Counter } from "../components/Counter"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ServerQueryProbe } from "../components/ServerQueryProbe"
import { syncClientI18n } from "../lib/i18n"
import { loadRoutePageData } from "../lib/server"

export default function LocalePage() {
  const params = useParams()
  const pageData = createAsync(() => loadRoutePageData(params.locale))

  return (
    <Show when={pageData()}>
      {(page) => {
        const data = page()
        syncClientI18n(data.locale)

        return (
          <main class="page-shell">
            <ClientReady />

            <section class="hero">
              <p class="kicker">SolidStart</p>
              <h1>{t`Palamedes in SolidStart with one runtime model.`}</h1>
              <p>
                <Trans>
                  This example proves a route-based locale flow in SolidStart with
                  SSR, locale segments, host-mapping suggestions, .po imports, and
                  localized server queries.
                </Trans>
              </p>
              {data.banner ? (
                <div class="panel" style={{ "background": "#fff7ed", "border-color": "#d97706" }}>
                  <p class="kicker">
                    <Trans>Locale suggestion</Trans>
                  </p>
                  <p class="muted">{data.banner.description}</p>
                  <a class="button" data-testid="locale-suggestion-cta" href={data.banner.recommendedUrl}>
                    <Trans>Switch to the recommended locale</Trans>
                  </a>
                </div>
              ) : null}
              <div class="button-row">
                <LocaleSwitcher locale={data.locale} />
              </div>
              <p class="footer-note">
                <Trans>Current locale:</Trans>{" "}
                <strong data-testid="server-locale-value">{data.localeLabel}</strong>
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
                  {t`This panel was rendered on the server for locale ${data.localeLabel}.`}
                </p>
                <div class="stats">
                  <div>
                    <span class="eyebrow">
                      <Trans>Rendered on server</Trans>
                    </span>
                    <code>{data.renderedAt}</code>
                  </div>
                </div>
              </section>

              <Counter locale={data.locale} />
              <ServerQueryProbe locale={data.locale} />
            </section>
          </main>
        )
      }}
    </Show>
  )
}
