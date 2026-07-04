import { t } from "@palamedes/core/macro"
import { useClientLocale } from "@palamedes/react/client"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import type { Route } from "./+types/home"
import { ClientReady } from "~/components/ClientReady"
import { LocaleSwitcher } from "~/components/LocaleSwitcher"
import { ProofPanel } from "~/components/ProofPanel"
import { SuggestionBanner } from "~/components/SuggestionBanner"
import { TicketPanel } from "~/components/TicketPanel"
import {
  activateServerI18n,
  DEFAULT_LOCALE,
  getLocaleLabel,
  resolveSubdomainLocale,
  syncClientI18n,
} from "~/lib/i18n"

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: `React Router Subdomain Locale Example (${loaderData?.locale ?? DEFAULT_LOCALE})` },
    {
      name: "description",
      content: "Subdomain-driven Palamedes locale proof for React Router framework mode.",
    },
  ]
}

export async function loader({ request }: Route.LoaderArgs) {
  const { banner, host, locale } = resolveSubdomainLocale(request)
  activateServerI18n(locale)

  return {
    banner,
    host,
    locale,
    localeLabel: getLocaleLabel(locale),
  }
}

export async function action({ request }: Route.ActionArgs) {
  const { locale } = resolveSubdomainLocale(request)
  activateServerI18n(locale)

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
  const { banner, host, locale, localeLabel } = loaderData

  useClientLocale(locale, syncClientI18n)

  return (
    <main className="page-shell">
      {banner ? (
        <SuggestionBanner
          currentLocale={locale}
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
        <LocaleSwitcher host={host} locale={locale} />
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
