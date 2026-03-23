import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { resolveCookieLocale } from "@palamedes/example-locale-shared"
import { unstable_getHeaders } from "waku/server"
import { Counter } from "../components/Counter"
import { LocaleSwitcher } from "../components/LocaleSwitcher"
import { ServerActionProbe } from "../components/ServerActionProbe"
import { activateServerI18n, getLocaleLabel, type Locale } from "../lib/i18n"

type ProbeResult = null | {
  handledAt: string
  locale: Locale
  localeLabel: string
  message: string
}

export default async function CookiePage() {
  const headers = unstable_getHeaders()
  const { locale, source } = resolveCookieLocale({
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
  })
  const localeLabel = getLocaleLabel(locale)

  activateServerI18n(locale)

  async function runProbe(): Promise<ProbeResult> {
    "use server"

    activateServerI18n(locale)

    return {
      handledAt: new Date().toISOString(),
      locale,
      localeLabel,
      message: t`Server action confirmed locale ${locale}.`,
    }
  }

  return (
    <>
      <title>Waku Cookie Locale Example</title>

      <section className="hero">
        <p className="kicker">Waku</p>
        <h1>{t`Palamedes without framework-specific runtime wrappers.`}</h1>
        <p>
          <Trans>
            This cookie-based Waku example derives the first locale from
            Accept-Language, persists it with a cookie write endpoint, and keeps
            server components plus server actions localized.
          </Trans>
        </p>
        <LocaleSwitcher locale={locale} />
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
          <div className="stats">
            <div>
              <span className="eyebrow">
                <Trans>Locale source</Trans>
              </span>
              <strong>{source}</strong>
            </div>
            <div>
              <span className="eyebrow">
                <Trans>Current locale</Trans>
              </span>
              <strong data-testid="server-locale-value">{localeLabel}</strong>
            </div>
          </div>
        </section>

        <Counter locale={locale} />
        <ServerActionProbe locale={locale} runProbe={runProbe} />
      </section>
    </>
  )
}

export async function getConfig() {
  return {
    render: "dynamic",
  } as const
}
