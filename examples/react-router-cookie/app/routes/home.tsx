import { useEffect } from "react"
import { Form, redirect, useActionData } from "react-router"
import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import type { Route } from "./+types/home"
import { Counter } from "~/components/Counter"
import {
  LOCALES,
  LOCALE_COOKIE,
  activateServerI18n,
  resolveLocaleFromRequest,
  syncClientI18n,
} from "~/lib/i18n"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "React Router Cookie Locale Example" },
    { name: "description", content: "Cookie-driven Palamedes locale proof for React Router framework mode." },
  ]
}

export async function loader({ request }: Route.LoaderArgs) {
  const resolved = resolveLocaleFromRequest(request)
  await activateServerI18n(resolved.locale)

  return {
    locale: resolved.locale,
    localeLabel: resolved.locale === "de" ? "Deutsch" : resolved.locale === "es" ? "Espanol" : "English",
    renderedAt: new Date().toISOString(),
    source: resolved.source,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get("intent")
  const resolved = resolveLocaleFromRequest(request)

  if (intent === "set-locale") {
    const locale = String(formData.get("locale") ?? resolved.locale)
    return redirect("/", {
      headers: {
        "Set-Cookie": `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`,
      },
    })
  }

  await activateServerI18n(resolved.locale)

  return {
    proof: {
      handledAt: new Date().toISOString(),
      locale: resolved.locale,
      localeLabel: resolved.locale === "de" ? "Deutsch" : resolved.locale === "es" ? "Espanol" : "English",
      message: t`Server action confirmed locale ${resolved.locale}.`,
    },
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
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
            This cookie-based React Router example derives the first locale from
            Accept-Language, persists it in a cookie, and keeps SSR plus route
            actions localized.
          </Trans>
        </p>
        <div className="button-row">
          {LOCALES.map((locale) => (
            <Form key={locale} method="post">
              <input name="intent" type="hidden" value="set-locale" />
              <button
                className={`chip${loaderData.locale === locale ? " active" : ""}`}
                data-testid={`locale-switch-${locale}`}
                name="locale"
                type="submit"
                value={locale}
              >
                {locale === "de" ? "Deutsch" : locale === "es" ? "Espanol" : "English"}
              </button>
            </Form>
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
                <Trans>Locale source</Trans>
              </span>
              <strong>{loaderData.source}</strong>
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
            <input name="intent" type="hidden" value="probe" />
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
