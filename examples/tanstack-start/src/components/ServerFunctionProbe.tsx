import { useEffect, useState, useTransition } from "react"
import { Trans } from "@palamedes/react/macro"
import { syncClientI18n, type Locale } from "../lib/i18n"
import { getLocalizedServerStatus } from "../lib/server-functions"

interface ServerFunctionResult {
  locale: Locale
  localeLabel: string
  handledAt: string
  message: string
}

interface ServerFunctionProbeProps {
  locale: Locale
}

export function ServerFunctionProbe({ locale }: ServerFunctionProbeProps) {
  syncClientI18n(locale)
  const [result, setResult] = useState<ServerFunctionResult | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const nextResult = await getLocalizedServerStatus({ data: { locale } })
      setResult(nextResult)
    })
  }, [locale])

  function refresh() {
    startTransition(async () => {
      const nextResult = await getLocalizedServerStatus({ data: { locale } })
      setResult(nextResult)
    })
  }

  return (
    <section className="panel">
      <p className="kicker">
        <Trans>Server function proof</Trans>
      </p>
      <h2>
        <Trans>Localized server function result</Trans>
      </h2>
      <p className="muted">
        <Trans>
          The text below is returned from a TanStack Start server function after the
          server activates the Palamedes locale for the current request.
        </Trans>
      </p>
      <div className="button-row">
        <button className="button" disabled={isPending} onClick={refresh} type="button">
          <Trans>Refresh server result</Trans>
        </button>
      </div>
      {result ? (
        <div className="stats">
          <div>
            <span className="eyebrow">
              <Trans>Server locale</Trans>
            </span>
            <strong>{result.localeLabel}</strong>
          </div>
          <div>
            <span className="eyebrow">
              <Trans>Handled at</Trans>
            </span>
            <code>{result.handledAt}</code>
          </div>
          <div>
            <span className="eyebrow">
              <Trans>Localized message</Trans>
            </span>
            <strong>{result.message}</strong>
          </div>
        </div>
      ) : (
        <p className="muted">
          <Trans>Waiting for the first server roundtrip...</Trans>
        </p>
      )}
    </section>
  )
}
