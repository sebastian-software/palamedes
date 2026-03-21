'use client';

import { useEffect, useState, useTransition } from "react"
import { Trans } from "@palamedes/react/macro"
import { syncClientI18n, type Locale } from "../lib/i18n"

type ProbeResult = null | {
  handledAt: string
  locale: Locale
  localeLabel: string
  message: string
}

export const ServerActionProbe = ({
  locale,
  runProbe,
}: {
  locale: Locale
  runProbe: () => Promise<ProbeResult>
}) => {
  syncClientI18n(locale)
  const [result, setResult] = useState<ProbeResult>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  function handleProbe() {
    startTransition(async () => {
      setResult(await runProbe())
    })
  }

  return (
    <section className="panel">
      {isHydrated ? <span aria-hidden="true" data-testid="client-ready" style={{ display: "none" }}>ready</span> : null}
      <p className="kicker">
        <Trans>Server action proof</Trans>
      </p>
      <h2>
        <Trans>Localized server action result</Trans>
      </h2>
      <button className="button" data-testid="server-proof-trigger" disabled={isPending} onClick={handleProbe} type="button">
        <Trans>Ask server for localized status</Trans>
      </button>
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
            <strong data-testid="server-proof-message">{result.message}</strong>
          </div>
        </div>
      ) : (
        <p className="muted">
          <Trans>Run the action to fetch a server-localized result.</Trans>
        </p>
      )}
    </section>
  )
}
