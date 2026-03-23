import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import type { PageProps } from "waku/router"
import { unstable_getHeaders } from "waku/server"
import { Counter } from "../components/Counter"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ServerActionProbe } from "../components/ServerActionProbe"
import {
  activateServerI18n,
  createBanner,
  getLocaleLabel,
  normalizeLocale,
  type Locale,
} from "../lib/i18n"

type ProbeResult = null | {
  handledAt: string
  locale: Locale
  localeLabel: string
  message: string
}

export default async function RoutePage({ locale }: PageProps<"/[locale]">) {
  const currentLocale = normalizeLocale(locale)
  const headers = unstable_getHeaders()
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
      <title>Waku Route Locale Example</title>

      <section className="hero">
        <p className="kicker">Waku</p>
        <h1>{t`Palamedes without framework-specific runtime wrappers.`}</h1>
        <p>
          <Trans>
            This route-based Waku example keeps locale in the URL, shows host or
            Accept-Language mismatch hints, and localizes server components plus
            server actions.
          </Trans>
        </p>
        {banner ? (
          <section className="panel" style={{ borderColor: "#d97706", background: "#fff7ed" }}>
            <p className="kicker">
              <Trans>Locale suggestion</Trans>
            </p>
            <p className="muted">{banner.description}</p>
            <a className="button" data-testid="locale-suggestion-cta" href={banner.recommendedUrl}>
              <Trans>Switch to the recommended locale</Trans>
            </a>
          </section>
        ) : null}
        <LocaleSwitcher locale={currentLocale} />
        <p className="muted" style={{ marginTop: "1rem" }}>
          <Trans>Current locale:</Trans> <strong data-testid="server-locale-value">{localeLabel}</strong>
        </p>
      </section>

      <section className="grid cols-2">
        <section className="panel">
          <p className="kicker">
            <Trans>Server-rendered proof</Trans>
          </p>
          <h2>
            <Trans>SSR translation happens before the page reaches the browser.</Trans>
          </h2>
          <p className="muted">
            {t`This panel was rendered on the server for locale ${localeLabel}.`}
          </p>
        </section>

        <Counter locale={currentLocale} />
        <ServerActionProbe locale={currentLocale} runProbe={runProbe} />
      </section>
    </>
  )
}

export async function getConfig() {
  return {
    render: "dynamic",
  } as const
}
