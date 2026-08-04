import { Link, redirect } from "react-router"
import { plural } from "@palamedes/core/macro"
import { Trans as Fmt } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import type { Route } from "./+types/insights"
import { LocaleSwitcher } from "~/components/LocaleSwitcher"
import { LOCALE_COOKIE, getLocaleLabel, resolveLocaleFromRequest } from "~/lib/i18n"
import { activateServerI18n } from "~/lib/i18n.server"

const TALKS_SCHEDULED = 48
const WORKSHOPS_WITH_SEATS = 3
const COUNTRIES_REPRESENTED = 26

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Attendance Insights - React Router Cookie Locale Example" },
    {
      name: "description",
      content: "Route-level message splitting proof for Palamedes graph splitting.",
    },
  ]
}

export async function loader({ request }: Route.LoaderArgs) {
  const resolved = resolveLocaleFromRequest(request)
  activateServerI18n(resolved.locale)

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const intent = formData.get("intent")
  const resolved = resolveLocaleFromRequest(request)

  if (intent === "set-locale") {
    const locale = String(formData.get("locale") ?? resolved.locale)
    return redirect("/insights", {
      headers: {
        "Set-Cookie": `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`,
      },
    })
  }

  return null
}

export default function Insights({ loaderData }: Route.ComponentProps) {
  const { locale, localeLabel } = loaderData
  const workshops = WORKSHOPS_WITH_SEATS

  return (
    <main className="page-shell">
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
        <h1 data-testid="insights-heading">
          <Trans>Attendance insights</Trans>
        </h1>
        <p className="lede">
          <Trans>Live numbers for the current ticket sale, rendered on their own route.</Trans>
        </p>
      </section>

      <div className="facts">
        <div className="fact">
          <p className="fact-label">
            <Trans>Registered attendees</Trans>
          </p>
          <p className="fact-value">
            <Fmt message="{count, number}" values={{ count: EVENT.attendeeCount }} />
          </p>
        </div>

        <div className="fact">
          <p className="fact-label">
            <Trans>Talks scheduled</Trans>
          </p>
          <p className="fact-value">
            <Fmt message="{count, number}" values={{ count: TALKS_SCHEDULED }} />
          </p>
        </div>

        <div className="fact">
          <p className="fact-label">
            <Trans>Countries represented</Trans>
          </p>
          <p className="fact-value">
            <Fmt message="{count, number}" values={{ count: COUNTRIES_REPRESENTED }} />
          </p>
        </div>

        <div className="fact">
          <p className="fact-label">
            <Trans>Workshop capacity</Trans>
          </p>
          <p className="fact-value" data-testid="insights-workshops">
            {plural(workshops, {
              one: "# workshop still has open seats",
              other: "# workshops still have open seats",
            })}
          </p>
        </div>
      </div>

      <footer className="foot">
        <span className="foot-badge">Palamedes</span>
        <Link to="/">
          <Trans>Back to ticket sale</Trans>
        </Link>
        {" · "}
        <Trans>server locale</Trans>{" "}
        <strong data-testid="server-locale-value">{localeLabel}</strong>
      </footer>
    </main>
  )
}
