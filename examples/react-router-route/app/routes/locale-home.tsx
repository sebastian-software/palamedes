import { useEffect } from "react"
import { Form, Link, useActionData } from "react-router"
import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import type { Route } from "./+types/locale-home"
import { Counter } from "~/components/Counter"
import {
  LOCALES,
  activateServerI18n,
  getRouteBanner,
  syncClientI18n,
  type Locale,
} from "~/lib/i18n"

function normalizeLocale(value: string): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : "en"
}

function getLocaleLabel(locale: Locale) {
  return locale === "de" ? "Deutsch" : locale === "es" ? "Espanol" : "English"
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: `React Router Route Locale Example (${params.locale ?? "en"})` },
    { name: "description", content: "Route-driven Palamedes locale proof for React Router framework mode." },
  ]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const locale = normalizeLocale(params.locale)
  await activateServerI18n(locale)

  return {
    banner: getRouteBanner(request, locale),
    locale,
    localeLabel: getLocaleLabel(locale),
    renderedAt: new Date().toISOString(),
  }
}

export async function action({ params }: Route.ActionArgs) {
  const locale = normalizeLocale(params.locale)
  await activateServerI18n(locale)

  return {
    proof: {
      handledAt: new Date().toISOString(),
      locale,
      localeLabel: getLocaleLabel(locale),
      message: t`Server action confirmed locale ${locale}.`,
    },
  }
}

export default function LocaleHome({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>()
  const localeLabel = loaderData.localeLabel

  useEffect(() => {
    void syncClientI18n(loaderData.locale)
  }, [loaderData.locale])

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="kicker">React Router</p>
        <h1>{t`Palamedes without framework-specific runtime wrappers.`}</h1>
        <p>
          <Trans>
            This route-based React Router example keeps locale in the URL,
            surfaces host or Accept-Language mismatches, and localizes SSR plus
            route actions.
          </Trans>
        </p>
        {loaderData.banner ? (
          <section className="panel" style={{ borderColor: "#d97706", background: "#fff7ed" }}>
            <p className="kicker">
              <Trans>Locale suggestion</Trans>
            </p>
            <p className="muted">{loaderData.banner.description}</p>
            <a className="button" data-testid="locale-suggestion-cta" href={loaderData.banner.recommendedUrl}>
              <Trans>Switch to the recommended locale</Trans>
            </a>
          </section>
        ) : null}
        <div className="button-row">
          {LOCALES.map((locale) => (
            <Link
              key={locale}
              className={`chip${loaderData.locale === locale ? " active" : ""}`}
              data-testid={`locale-switch-${locale}`}
              to={`/${locale}`}
            >
              {getLocaleLabel(locale)}
            </Link>
          ))}
        </div>
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
                <Trans>Current locale</Trans>
              </span>
              <strong data-testid="server-locale-value">{localeLabel}</strong>
            </div>
            <div>
              <span className="eyebrow">
                <Trans>Rendered on server</Trans>
              </span>
              <code>{loaderData.renderedAt}</code>
            </div>
          </div>
        </section>

        <Counter locale={loaderData.locale} />

        <section className="panel">
          <p className="kicker">
            <Trans>Server action proof</Trans>
          </p>
          <h2>
            <Trans>Localized action result</Trans>
          </h2>
          <Form method="post">
            <button className="button" data-testid="server-proof-trigger" type="submit">
              <Trans>Ask server for localized status</Trans>
            </button>
          </Form>
          {actionData?.proof ? (
            <div className="stats">
              <div>
                <span className="eyebrow">
                  <Trans>Server locale</Trans>
                </span>
                <strong>{actionData.proof.localeLabel}</strong>
              </div>
              <div>
                <span className="eyebrow">
                  <Trans>Handled at</Trans>
                </span>
                <code>{actionData.proof.handledAt}</code>
              </div>
              <div>
                <span className="eyebrow">
                  <Trans>Localized message</Trans>
                </span>
                <strong data-testid="server-proof-message">{actionData.proof.message}</strong>
              </div>
            </div>
          ) : (
            <p className="muted">
              <Trans>Run the action to fetch a server-localized result.</Trans>
            </p>
          )}
        </section>
      </section>
    </main>
  )
}
