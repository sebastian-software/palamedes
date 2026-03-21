import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { Counter } from "./Counter"
import { LocaleSwitcher } from "./LocaleSwitcher"
import { ServerActionProbe } from "./ServerActionProbe"
import { activateServerI18n, getLocaleLabel, type Locale } from "../lib/i18n"
import type { LocaleBanner } from "@palamedes/example-locale-shared"

type ProbeResult = null | {
  handledAt: string
  locale: Locale
  localeLabel: string
  message: string
}

export default function App({
  banner,
  locale,
}: {
  banner: LocaleBanner | null
  locale: Locale
}) {
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
        <title>Waku Route Locale Example</title>
        <style>{`
          html, body { margin: 0; padding: 0; font-family: "Iowan Old Style", "Palatino Linotype", serif; background: linear-gradient(180deg, #f8fafc 0%, #ecfeff 100%); color: #0f172a; }
          .page-shell { max-width: 72rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
          .hero, .panel { border: 1px solid rgba(8, 145, 178, 0.16); background: rgba(255,255,255,0.92); border-radius: 1.25rem; box-shadow: 0 1.5rem 4rem rgba(15,23,42,0.08); }
          .hero { padding: 2rem; }
          .panel { padding: 1.25rem; }
          .grid { display: grid; gap: 1rem; margin-top: 1.5rem; }
          .cols-2 { grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
          .button-row { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
          .button, .chip { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.1rem; border-radius: 999px; border: none; background: #ccfbf1; color: #115e59; text-decoration: none; cursor: pointer; font: inherit; }
          .chip.active { background: #115e59; color: white; }
          .kicker, .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; color: #0f766e; }
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
                This route-based Waku example keeps locale in the URL, shows host
                or Accept-Language mismatch hints, and localizes server
                components plus server actions.
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
            <LocaleSwitcher locale={locale} />
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

            <Counter locale={locale} />
            <ServerActionProbe locale={locale} runProbe={runProbe} />
          </section>
        </main>
      </body>
    </html>
  )
}
