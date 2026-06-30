import { redirect } from "react-router"
import { t } from "@palamedes/core/macro"
import { useClientLocale } from "@palamedes/react/client"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import type { Route } from "./+types/home"
import { ClientReady } from "~/components/ClientReady"
import { LocaleSwitcher } from "~/components/LocaleSwitcher"
import { ProofPanel } from "~/components/ProofPanel"
import { TicketPanel } from "~/components/TicketPanel"
import {
  LOCALE_COOKIE,
  activateServerI18n,
  getLocaleLabel,
  resolveLocaleFromRequest,
  syncClientI18n,
} from "~/lib/i18n"

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "React Router Cookie Locale Example" },
    {
      name: "description",
      content: "Cookie-driven Palamedes locale proof for React Router framework mode.",
    },
  ]
}

export async function loader({ request }: Route.LoaderArgs) {
  const resolved = resolveLocaleFromRequest(request)
  activateServerI18n(resolved.locale)

  return {
    locale: resolved.locale,
    localeLabel: getLocaleLabel(resolved.locale),
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

  activateServerI18n(resolved.locale)

  return {
    proof: {
      handledAt: new Date().toISOString(),
      locale: resolved.locale,
      localeLabel: getLocaleLabel(resolved.locale),
      message: t`Server action confirmed locale ${resolved.locale}.`,
    },
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { locale, localeLabel } = loaderData

  useClientLocale(locale, syncClientI18n)

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
        <ProofPanel locale={locale} />
      </div>

      <footer className="foot">
        <span className="foot-badge">Palamedes</span>
        <Trans>Rendered with React Router</Trans>
        {" · "}
        <Trans>server locale</Trans>{" "}
        <strong data-testid="server-locale-value">{localeLabel}</strong>
      </footer>

      <ClientReady />
    </main>
  )
}
