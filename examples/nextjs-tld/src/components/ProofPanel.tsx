"use client"

import { useEffect, useState, useTransition } from "react"
import { plural } from "@palamedes/core/macro"
import { Trans as Fmt } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import { EVENT } from "@palamedes/example-ui"
import type { Locale } from "@/lib/i18n"
import { getServerActionProof } from "@/lib/actions"

type ProofPanelProps = {
  locale: Locale
}

export function ProofPanel({ locale }: ProofPanelProps) {
  const when = new Date(EVENT.startsAt)
  const seats = EVENT.seatsLeft
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function refresh() {
    startTransition(async () => {
      const result = await getServerActionProof(locale)
      setMessage(result.message)
    })
  }

  useEffect(() => {
    startTransition(async () => {
      const result = await getServerActionProof(locale)
      setMessage(result.message)
    })
  }, [locale])

  return (
    <aside className="aside">
      <div className="aside-head">
        <h3>
          <Trans>Behind the scenes</Trans>
        </h3>
        <span>
          <Trans>one switch, every format</Trans>
        </span>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Plural</Trans>
          </span>
          <span className="feat-out">
            {plural(seats, { one: "# seat left", other: "# seats left" })}
          </span>
        </div>
        <code>{`plural(seats, { one: "# seat left", other: "# seats left" })`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Currency</Trans>
          </span>
          <span className="feat-out">
            <Fmt
              message="{amount, number, ::currency/EUR}"
              values={{ amount: EVENT.ticketPrice }}
            />
          </span>
        </div>
        <code>{`{amount, number, ::currency/EUR}`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Number</Trans>
          </span>
          <span className="feat-out">
            <Fmt message="{count, number}" values={{ count: EVENT.attendeeCount }} />
          </span>
        </div>
        <code>{`{count, number}`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Date</Trans>
          </span>
          <span className="feat-out is-text">
            <Fmt message="{when, date, medium}" values={{ when }} />
          </span>
        </div>
        <code>{`{when, date, full}`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Server</Trans>
          </span>
          <span className="feat-out is-text" data-testid="server-proof-message">
            {message ?? "…"}
          </span>
        </div>
        <button
          className="cta"
          data-testid="server-proof-trigger"
          disabled={isPending}
          onClick={refresh}
          type="button"
        >
          <Trans>Refresh server result</Trans>
        </button>
      </div>
    </aside>
  )
}
