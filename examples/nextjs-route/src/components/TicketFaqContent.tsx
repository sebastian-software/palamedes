"use client";

import { Trans } from "@palamedes/react/macro";

export function TicketFaqContent() {
  return (
    <div data-testid="ticket-faq-content">
      <h3>
        <Trans>Frequently asked questions</Trans>
      </h3>
      <p>
        <Trans>Tickets are refundable until seven days before the event.</Trans>
      </p>
    </div>
  );
}
