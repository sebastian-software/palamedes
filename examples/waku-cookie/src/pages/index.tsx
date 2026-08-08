import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import { unstable_getHeaders } from "waku/router/server"
import { ClientReady } from "../components/ClientReady"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ProofPanel } from "../components/ProofPanel"
import { TicketPanel } from "../components/TicketPanel"
import { getLocaleLabel, resolveCookieLocale, type Locale } from "../lib/i18n"
import {
  asynchronousServerActionMessage,
  synchronousServerActionMessage,
} from "../lib/server-action-helpers.server"
import { crossModuleServerActionMessage } from "../lib/server-action-cross-module.server"

type ProbeResult = {
  handledAt: string
  locale: Locale
  localeLabel: string
  messages: Record<
    "asynchronous" | "crossModule" | "defaultParameter" | "direct" | "synchronous",
    string
  >
}

export default async function CookiePage() {
  const headers = unstable_getHeaders()
  const { locale } = resolveCookieLocale(headers)
  const localeLabel = getLocaleLabel(locale)

  async function runProbe(
    defaultParameter = t`Parameter default confirmed locale.`
  ): Promise<ProbeResult> {
    "use server"

    return {
      handledAt: new Date().toISOString(),
      locale,
      localeLabel,
      messages: {
        asynchronous: await asynchronousServerActionMessage(),
        crossModule: crossModuleServerActionMessage(),
        defaultParameter,
        direct: t`Server action confirmed locale ${locale}.`,
        synchronous: synchronousServerActionMessage(),
      },
    }
  }

  return (
    <>
      <title>Frontend Stage · Palamedes + Waku</title>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__PALAMEDES_LOCALE__=${JSON.stringify(locale)};`,
        }}
      />

      <header className="topbar">
        <div className="brand">
          <b>Frontend Stage</b>
          <span className="brand-meta">Berlin · 2026</span>
        </div>
        <LocaleSwitcher locale={locale} />
      </header>

      <section className="hero">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          <Trans>Localized for this document with Palamedes</Trans>
        </p>
        <h1>
          <Trans>Book your seat at Frontend Stage 2026</Trans>
        </h1>
        <p className="greet">{t`Welcome back, ${EVENT.attendeeName}.`}</p>
        <p className="lede">
          <Trans>
            Three days of talks on the craft of building for the web. Choose your tickets below.
          </Trans>
        </p>
      </section>

      <div className="grid">
        <TicketPanel />
        <ProofPanel runProbe={runProbe} />
      </div>

      <footer className="foot">
        <span className="foot-badge">Palamedes</span>
        <Trans>Rendered with Waku</Trans>
        {" · "}
        <Trans>server locale</Trans>{" "}
        <strong data-testid="server-locale-value">{localeLabel}</strong>
      </footer>

      <ClientReady />
    </>
  )
}

export async function getConfig() {
  return {
    render: "dynamic",
  } as const
}
