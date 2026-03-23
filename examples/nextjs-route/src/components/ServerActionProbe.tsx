"use client"

import { useState, useTransition } from "react"
import { Trans } from "@palamedes/react/macro"
import { getServerActionProof } from "@/lib/actions"
import { syncClientI18n } from "@/lib/i18n.client"
import type { Locale } from "@/lib/i18n"

interface ServerActionProof {
  locale: Locale
  localeLabel: string
  handledAt: string
  message: string
}

interface ServerActionProbeProps {
  locale: Locale
}

export function ServerActionProbe({ locale }: ServerActionProbeProps) {
  syncClientI18n(locale)
  const [result, setResult] = useState<ServerActionProof | null>(null)
  const [isPending, startTransition] = useTransition()

  function runProbe() {
    startTransition(async () => {
      const nextResult = await getServerActionProof(locale)
      setResult(nextResult)
    })
  }

  return (
    <section style={{ marginTop: "2rem" }}>
      <p style={{ color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "0.75rem" }}>
        <Trans>Server action proof</Trans>
      </p>
      <h2>
        <Trans>Localized server action result</Trans>
      </h2>
      <p style={{ color: "#666" }}>
        <Trans>
          This button calls a dedicated server action that receives the current
          route locale and returns localized text from the server.
        </Trans>
      </p>
      <button
        data-testid="server-proof-trigger"
        onClick={runProbe}
        disabled={isPending}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          background: "#0f766e",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: isPending ? "progress" : "pointer",
        }}
      >
        <Trans>Ask server for localized status</Trans>
      </button>
      {result ? (
        <dl
          style={{
            marginTop: "1rem",
            display: "grid",
            gridTemplateColumns: "minmax(0, 12rem) minmax(0, 1fr)",
            gap: "0.5rem 1rem",
          }}
        >
          <dt>
            <Trans>Server locale</Trans>
          </dt>
          <dd style={{ margin: 0 }}>{result.localeLabel}</dd>
          <dt>
            <Trans>Handled at</Trans>
          </dt>
          <dd style={{ margin: 0 }}>
            <code>{result.handledAt}</code>
          </dd>
          <dt>
            <Trans>Localized message</Trans>
          </dt>
          <dd data-testid="server-proof-message" style={{ margin: 0 }}>{result.message}</dd>
        </dl>
      ) : (
        <p style={{ color: "#666", marginTop: "1rem" }}>
          <Trans>Run the action to fetch a server-localized result.</Trans>
        </p>
      )}
    </section>
  )
}
