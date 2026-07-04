import { createEffect, createSignal } from "solid-js"
import { plural } from "@palamedes/core/macro"
import { Trans as Fmt } from "@palamedes/solid"
import { Trans } from "@palamedes/solid/macro"
import { EVENT } from "@palamedes/example-ui"
import type { Locale } from "../lib/i18n"
import { getLocalizedServerStatus } from "../lib/server"

type ProofPanelProps = {
  locale: Locale
}

export function ProofPanel(props: ProofPanelProps) {
  const when = new Date(EVENT.startsAt)
  const seats = EVENT.seatsLeft
  const [message, setMessage] = createSignal<string | null>(null)
  const [isPending, setIsPending] = createSignal(false)

  // The server function resolves the locale authoritatively from the request
  // host, so no locale argument is needed — the call reaches the same host the
  // browser is on.
  async function refresh() {
    setIsPending(true)
    try {
      const result = await getLocalizedServerStatus()
      setMessage(result.message)
    } finally {
      setIsPending(false)
    }
  }

  createEffect(() => {
    // Re-run whenever the locale changes so the server message stays in sync.
    void props.locale
    void refresh()
  })

  return (
    <aside class="aside">
      <div class="aside-head">
        <h3>
          <Trans>Behind the scenes</Trans>
        </h3>
        <span>
          <Trans>one switch, every format</Trans>
        </span>
      </div>

      <div class="feat">
        <div class="feat-row">
          <span class="feat-name">
            <Trans>Plural</Trans>
          </span>
          <span class="feat-out">
            {plural(seats, { one: "# seat left", other: "# seats left" })}
          </span>
        </div>
        <code>{`plural(seats, { one: "# seat left", other: "# seats left" })`}</code>
      </div>

      <div class="feat">
        <div class="feat-row">
          <span class="feat-name">
            <Trans>Currency</Trans>
          </span>
          <span class="feat-out">
            <Fmt
              message="{amount, number, ::currency/EUR}"
              values={{ amount: EVENT.ticketPrice }}
            />
          </span>
        </div>
        <code>{`{amount, number, ::currency/EUR}`}</code>
      </div>

      <div class="feat">
        <div class="feat-row">
          <span class="feat-name">
            <Trans>Number</Trans>
          </span>
          <span class="feat-out">
            <Fmt message="{count, number}" values={{ count: EVENT.attendeeCount }} />
          </span>
        </div>
        <code>{`{count, number}`}</code>
      </div>

      <div class="feat">
        <div class="feat-row">
          <span class="feat-name">
            <Trans>Date</Trans>
          </span>
          <span class="feat-out is-text">
            <Fmt message="{when, date, medium}" values={{ when }} />
          </span>
        </div>
        <code>{`{when, date, full}`}</code>
      </div>

      <div class="feat">
        <div class="feat-row">
          <span class="feat-name">
            <Trans>Server</Trans>
          </span>
          <span class="feat-out is-text" data-testid="server-proof-message">
            {message() ?? "…"}
          </span>
        </div>
        <button
          class="cta"
          data-testid="server-proof-trigger"
          disabled={isPending()}
          onClick={refresh}
          type="button"
        >
          <Trans>Refresh server result</Trans>
        </button>
      </div>
    </aside>
  )
}
