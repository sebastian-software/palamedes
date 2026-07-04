import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import { unstable_getHeaders } from "waku/router/server"
import { ClientReady } from "../components/ClientReady"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ProofPanel } from "../components/ProofPanel"
import { SuggestionBanner } from "../components/SuggestionBanner"
import { TicketPanel } from "../components/TicketPanel"
import { activateServerI18n, createBanner, getLocaleLabel, locales, type Locale } from "../lib/i18n"

type ProbeResult = {
  handledAt: string
  locale: Locale
  localeLabel: string
  message: string
}

export default async function IndexPage() {
  const headers = unstable_getHeaders()
  const host = headers.host ?? null

  // TLD strategy: the rightmost DNS label is authoritative for the locale
  // (`.de` -> `de`, `.fr` -> `fr`), so the app is served at `/` and reads the
  // locale from the request host. Accept-Language is only a fallback for `.com`.
  const resolved = locales.resolve({
    strategy: "tld",
    acceptLanguageHeader: headers["accept-language"],
    requestHost: host,
  })
  const currentLocale = resolved.locale
  const localeLabel = getLocaleLabel(currentLocale)
  const banner = createBanner(headers, currentLocale)

  activateServerI18n(currentLocale)

  async function runProbe(): Promise<ProbeResult> {
    "use server"

    activateServerI18n(currentLocale)

    return {
      handledAt: new Date().toISOString(),
      locale: currentLocale,
      localeLabel,
      message: t`Server action confirmed locale ${currentLocale}.`,
    }
  }

  return (
    <>
      <title>Frontend Stage · Palamedes + Waku · TLD</title>

      {banner ? (
        <SuggestionBanner
          currentLocale={currentLocale}
          description={banner.description}
          recommendedLocale={banner.recommendedLocale}
          recommendedUrl={banner.recommendedUrl}
        />
      ) : null}

      <header className="topbar">
        <div className="brand">
          <b>Frontend Stage</b>
          <span className="brand-meta">Berlin · 2026</span>
        </div>
        <LocaleSwitcher host={host} locale={currentLocale} />
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
        <TicketPanel locale={currentLocale} />
        <ProofPanel locale={currentLocale} runProbe={runProbe} />
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
