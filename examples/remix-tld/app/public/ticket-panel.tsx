import { plural, t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/remix/macro";
import { EVENT } from "@palamedes/example-ui";
import type { Handle, RemixNode } from "remix/component";

export function TicketPanel(handle: Handle<{ quantity: number }>): () => RemixNode {
  return () => {
    const { quantity } = handle.props;
    const when = new Date(EVENT.startsAt);
    const seats = EVENT.seatsLeft;
    const total = EVENT.ticketPrice * quantity;

    return (
      <article className="ticket">
        <div className="ticket-head">
          <p className="kicker">
            <Trans>Conference pass</Trans>
          </p>
          <h2>{EVENT.eventTitle}</h2>
        </div>

        <div className="facts">
          <div className="fact">
            <p className="fact-label">
              <Trans>Date</Trans>
            </p>
            <p className="fact-value">
              {t({ message: "{when, date, full}" }, { when })}
              <small>{t({ message: "{when, time, short}" }, { when })}</small>
            </p>
          </div>

          <div className="fact">
            <p className="fact-label">
              <Trans>Venue</Trans>
            </p>
            <p className="fact-value">
              {EVENT.venueName}
              <small>
                <Trans>Berlin, Germany</Trans>
              </small>
            </p>
          </div>

          <div className="fact">
            <p className="fact-label">
              <Trans>Attendees</Trans>
            </p>
            <p className="fact-value">
              {t({ message: "{count, number}" }, { count: EVENT.attendeeCount })}
            </p>
          </div>

          <div className="fact">
            <p className="fact-label">
              <Trans>Availability</Trans>
            </p>
            <p className="fact-value">
              <span className="avail">
                <span className="pulse" aria-hidden="true" />
                {plural(seats, { one: "# seat left", other: "# seats left" })}
              </span>
            </p>
          </div>
        </div>

        <div className="buy">
          <div className="qty-row">
            <span className="qty-label">
              <b>{plural(quantity, { one: "# ticket", other: "# tickets" })}</b>
              {" · "}
              {t(
                { message: "{amount, number, ::currency/EUR}" },
                { amount: EVENT.ticketPrice },
              )}{" "}
              <Trans>each</Trans>
            </span>
            <div className="stepper">
              <button aria-label={t`Fewer tickets`} data-testid="ticket-decrease" type="button">
                −
              </button>
              <span className="stepper-num">{quantity}</span>
              <button aria-label={t`More tickets`} data-testid="ticket-increase" type="button">
                +
              </button>
            </div>
          </div>

          <div className="total-row">
            <span className="total-label">
              <Trans>Total</Trans>
            </span>
            <span className="total-value">
              {t({ message: "{amount, number, ::currency/EUR}" }, { amount: total })}
            </span>
          </div>

          <button className="cta" type="button">
            <Trans>Add to cart</Trans>
          </button>
        </div>
      </article>
    );
  };
}
