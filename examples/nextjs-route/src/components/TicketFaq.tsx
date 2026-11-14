"use client";

import { Suspense, lazy, useState } from "react";
import { Trans } from "@palamedes/react/macro";

/*
 * Loaded on demand so the example has a client chunk that only an importer's
 * dynamic import names: the permutation build must rewrite that reference
 * per locale, because no manifest lists it.
 */
const TicketFaqContent = lazy(() =>
  import("./TicketFaqContent").then((module) => ({ default: module.TicketFaqContent })),
);

export function TicketFaq() {
  const [open, setOpen] = useState(false);

  return (
    <section className="aside" data-testid="ticket-faq">
      <button type="button" data-testid="ticket-faq-toggle" onClick={() => setOpen(!open)}>
        {open ? <Trans>Hide the FAQ</Trans> : <Trans>Show the FAQ</Trans>}
      </button>
      {open ? (
        <Suspense
          fallback={
            <p>
              <Trans>Loading answers…</Trans>
            </p>
          }
        >
          <TicketFaqContent />
        </Suspense>
      ) : null}
    </section>
  );
}
