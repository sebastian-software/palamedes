import { createSignal } from "solid-js"
import { plural, t } from "@palamedes/core/macro"
import { Trans as Fmt } from "@palamedes/solid"
import { Trans } from "@palamedes/solid/macro"
import { EVENT } from "@palamedes/example-ui"
import type { Locale } from "../lib/i18n"

type TicketPanelProps = {
  locale: Locale
}

export function TicketPanel(_props: TicketPanelProps) {
  const [quantity, setQuantity] = createSignal(1)
  const when = new Date(EVENT.startsAt)
  const seats = EVENT.seatsLeft
  const total = () => EVENT.ticketPrice * quantity()

  return (
    <article class="ticket">
      <div class="ticket-head">
        <p class="kicker">
          <Trans>Conference pass</Trans>
        </p>
        <h2>{EVENT.eventTitle}</h2>
      </div>

      <div class="facts">
        <div class="fact">
          <p class="fact-label">
            <Trans>Date</Trans>
          </p>
          <p class="fact-value">
            <Fmt message="{when, date, full}" values={{ when }} />
            <small>
              <Fmt message="{when, time, short}" values={{ when }} />
            </small>
          </p>
        </div>

        <div class="fact">
          <p class="fact-label">
            <Trans>Venue</Trans>
          </p>
          <p class="fact-value">
            {EVENT.venueName}
            <small>
              <Trans>Berlin, Germany</Trans>
            </small>
          </p>
        </div>

        <div class="fact">
          <p class="fact-label">
            <Trans>Attendees</Trans>
          </p>
          <p class="fact-value">
            <Fmt message="{count, number}" values={{ count: EVENT.attendeeCount }} />
          </p>
        </div>

        <div class="fact">
          <p class="fact-label">
            <Trans>Availability</Trans>
          </p>
          <p class="fact-value">
            <span class="avail">
              <span class="pulse" aria-hidden="true" />
              {plural(seats, { one: "# seat left", other: "# seats left" })}
            </span>
          </p>
        </div>
      </div>

      <div class="buy">
        <div class="qty-row">
          <span class="qty-label">
            <b>{plural(quantity(), { one: "# ticket", other: "# tickets" })}</b>
            {" · "}
            <Fmt
              message="{amount, number, ::currency/EUR}"
              values={{ amount: EVENT.ticketPrice }}
            />{" "}
            <Trans>each</Trans>
          </span>
          <div class="stepper">
            <button
              aria-label={t`Fewer tickets`}
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              type="button"
            >
              −
            </button>
            <span class="stepper-num">{quantity()}</span>
            <button
              aria-label={t`More tickets`}
              onClick={() => setQuantity((value) => Math.min(EVENT.maxQuantity, value + 1))}
              type="button"
            >
              +
            </button>
          </div>
        </div>

        <div class="total-row">
          <span class="total-label">
            <Trans>Total</Trans>
          </span>
          <span class="total-value">
            <Fmt message="{amount, number, ::currency/EUR}" values={{ amount: total() }} />
          </span>
        </div>

        <button class="cta" type="button">
          <Trans>Add to cart</Trans>
        </button>
      </div>
    </article>
  )
}
