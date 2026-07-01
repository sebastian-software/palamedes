import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import { unstable_getHeaders } from "waku/router/server"
import { ClientReady } from "../components/ClientReady"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ProofPanel } from "../components/ProofPanel"
import { TicketPanel } from "../components/TicketPanel"
import { activateServerI18n, getLocaleLabel, type Locale, locales } from "../lib/i18n"

type ProbeResult = {
  handledAt: string
  locale: Locale
  localeLabel: string
  message: string
}

export default async function CookiePage() {
  const headers = unstable_getHeaders()
  const { locale } = locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
  })
  const localeLabel = getLocaleLabel(locale)

  await activateServerI18n(locale)

  async function runProbe(): Promise<ProbeResult> {
    "use server"

    await activateServerI18n(locale)

    return {
      handledAt: new Date().toISOString(),
      locale,
      localeLabel,
      message: t`Server action confirmed locale ${locale}.`,
    }
  }

  return (
    <>
      <title>Frontend Stage · Palamedes + Waku</title>

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
          <Trans>Localized live with Palamedes</Trans>
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
        <TicketPanel locale={locale} />
        <ProofPanel locale={locale} runProbe={runProbe} />
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
