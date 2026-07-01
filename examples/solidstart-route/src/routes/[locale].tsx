import { Show } from "solid-js"
import { createAsync, useParams } from "@solidjs/router"
import { t } from "@palamedes/core/macro"
import { createClientLocaleEffect } from "@palamedes/solid/client"
import { Trans } from "@palamedes/solid/macro"
import { EVENT } from "@palamedes/example-ui"
import { ClientReady } from "../components/ClientReady"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ProofPanel } from "../components/ProofPanel"
import { SuggestionBanner } from "../components/SuggestionBanner"
import { TicketPanel } from "../components/TicketPanel"
import { syncClientI18n } from "../lib/i18n"
import { loadRoutePageData } from "../lib/server"

type RoutePageData = {
  banner: {
    description: string
    recommendedUrl: string
  } | null
  locale: "en" | "de" | "es"
  localeLabel: string
  renderedAt: string
}

function RoutePageContent(props: { data: RoutePageData }) {
  createClientLocaleEffect(() => props.data.locale, syncClientI18n)

  return (
    <main class="page-shell">
      <Show when={props.data.banner}>
        {(banner) => (
          <SuggestionBanner
            currentLocale={props.data.locale}
            description={banner().description}
            recommendedLocale={banner().recommendedLocale}
            recommendedUrl={banner().recommendedUrl}
          />
        )}
      </Show>

      <header class="topbar">
        <div class="brand">
          <b>Frontend Stage</b>
          <span class="brand-meta">Berlin · 2026</span>
        </div>
        <LocaleSwitcher locale={props.data.locale} />
      </header>

      <section class="hero">
        <p class="eyebrow">
          <span class="dot" aria-hidden="true" />
          <Trans>Localized live with Palamedes</Trans>
        </p>
        <h1>
          <Trans>Book your seat at Frontend Stage 2026</Trans>
        </h1>
        <p class="greet">{t`Welcome back, ${EVENT.attendeeName}.`}</p>
        <p class="lede">
          <Trans>
            Three days of talks on the craft of building for the web. Choose your tickets below.
          </Trans>
        </p>
      </section>

      <div class="grid">
        <TicketPanel locale={props.data.locale} />
        <ProofPanel locale={props.data.locale} />
      </div>

      <footer class="foot">
        <span class="foot-badge">Palamedes</span>
        <Trans>Rendered with SolidStart</Trans>
        {" · "}
        <Trans>server locale</Trans>{" "}
        <strong data-testid="server-locale-value">{props.data.localeLabel}</strong>
      </footer>

      <ClientReady />
    </main>
  )
}

export default function LocalePage() {
  const params = useParams()
  const pageData = createAsync(() => loadRoutePageData(params.locale))

  return <Show when={pageData()}>{(page) => <RoutePageContent data={page()} />}</Show>
}
