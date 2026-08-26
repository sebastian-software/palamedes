import { createMemo, Show } from "solid-js"
import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/solid/macro"
import { EVENT } from "@palamedes/example-ui"
import { ClientReady } from "../components/ClientReady"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ProofPanel } from "../components/ProofPanel"
import { TicketPanel } from "../components/TicketPanel"
import { loadHomePageData } from "../lib/server"

type HomePageData = {
  locale: "en" | "de" | "es"
  localeLabel: string
  renderedAt: string
  source: string
}

function HomePageContent(props: { data: HomePageData }) {
  return (
    <main class="page-shell">
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
          <Trans>Localized for this document with Palamedes</Trans>
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
        <Trans>Rendered with Solid</Trans>
        {" · "}
        <Trans>server locale</Trans>{" "}
        <strong data-testid="server-locale-value">{props.data.localeLabel}</strong>
      </footer>

      <ClientReady />
    </main>
  )
}

export default function HomePage() {
  const pageData = createMemo(() => loadHomePageData())

  return (
    <Show when={pageData()}>
      {(page) => {
        const data = page()
        return <HomePageContent data={data} />
      }}
    </Show>
  )
}
