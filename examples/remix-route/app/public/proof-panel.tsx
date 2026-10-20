import { plural, t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/remix/macro";
import { EVENT } from "@palamedes/example-ui";
import type { Handle, RemixNode } from "remix/component";

export function ProofPanel(
  handle: Handle<{ message: string; refreshing: boolean; failed: boolean }>,
): () => RemixNode {
  return () => {
    const when = new Date(EVENT.startsAt);
    const seats = EVENT.seatsLeft;
    const { message, refreshing, failed } = handle.props;
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
              {t({ message: "{amount, number, ::currency/EUR}" }, { amount: EVENT.ticketPrice })}
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
              {t({ message: "{count, number}" }, { count: EVENT.attendeeCount })}
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
              {t({ message: "{when, date, medium}" }, { when })}
            </span>
          </div>
          <code>{`{when, date, medium}`}</code>
        </div>

        <div className="feat">
          <div className="feat-row">
            <span className="feat-name">
              <Trans>Server</Trans>
            </span>
            <span className="feat-out is-text" data-testid="server-proof-message">
              {failed ? t`The server request failed. Try again.` : message}
            </span>
          </div>
          <button
            className="cta"
            data-testid="server-proof-trigger"
            disabled={refreshing}
            type="button"
          >
            <Trans>Refresh server result</Trans>
          </button>
        </div>
      </aside>
    );
  };
}
