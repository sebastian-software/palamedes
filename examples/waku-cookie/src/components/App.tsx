import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { unstable_getContextData as getContextData } from "waku/server"
import { Counter } from "./Counter"
import { LocaleSwitcher } from "./LocaleSwitcher"
import { ServerActionProbe } from "./ServerActionProbe"
import { activateServerI18n, getLocaleLabel, type Locale } from "../lib/i18n"

type ProbeResult = null | {
  handledAt: string
  locale: Locale
  localeLabel: string
  message: string
}

export default function App() {
  const data = getContextData() as {
    locale?: Locale
    source?: string
  }
  const locale = data.locale ?? "en"
  const localeLabel = getLocaleLabel(locale)
  activateServerI18n(locale)

  async function runProbe(): Promise<ProbeResult> {
    'use server';
    activateServerI18n(locale)

    return {
      handledAt: new Date().toISOString(),
      locale,
      localeLabel,
      message: t`Server action confirmed locale ${locale}.`,
    }
  }

  return (
    <html>
      <head>
        <title>Waku Cookie Locale Example</title>
        <style>{`
          html, body { margin: 0; padding: 0; font-family: "Iowan Old Style", "Palatino Linotype", serif; background: linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%); color: #172554; }
          .page-shell { max-width: 72rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
          .hero, .panel { border: 1px solid rgba(37, 99, 235, 0.16); background: rgba(255,255,255,0.92); border-radius: 1.25rem; box-shadow: 0 1.5rem 4rem rgba(15,23,42,0.08); }
          .hero { padding: 2rem; }
          .panel { padding: 1.25rem; }
          .grid { display: grid; gap: 1rem; margin-top: 1.5rem; }
          .cols-2 { grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
          .button-row { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
          .button, .chip { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.1rem; border-radius: 999px; border: none; background: #dbeafe; color: #1d4ed8; text-decoration: none; cursor: pointer; font: inherit; }
          .chip.active { background: #1d4ed8; color: white; }
          .kicker, .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; color: #1d4ed8; }
          .muted { color: #475569; }
          .stats { display: grid; gap: 0.75rem; margin-top: 1rem; }
          code { word-break: break-word; }
        `}</style>
      </head>
      <body>
        <main className="page-shell">
          <section className="hero">
            <p className="kicker">Waku</p>
            <h1>{t`Palamedes without framework-specific runtime wrappers.`}</h1>
            <p>
              <Trans>
                This cookie-based Waku example derives the first locale from
                Accept-Language, persists it with a cookie write endpoint, and
                keeps server components plus server actions localized.
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
                  <strong>{data.source ?? "default"}</strong>
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
        </main>
      </body>
    </html>
  )
}
