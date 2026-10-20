import { t } from "@palamedes/core/macro";
import { Plural, Select, Trans } from "@palamedes/remix/macro";
import { TicketPanel } from "./ticket-panel.tsx";
import { ProofPanel } from "./proof-panel.tsx";
import type { Handle, RemixNode } from "remix/component";

export type ClientProofProps = {
  audience: "developer" | "other";
  count: number;
  locale?: string;
  quantity?: number;
  serverMessage?: string;
  refreshing?: boolean;
  serverFailed?: boolean;
  lazyText?: string;
  framesHref?: string;
};

/** Shared by SSR and the browser so Remix UI exercises its hydration path. */
export function ClientProof(handle: Handle<ClientProofProps>): () => RemixNode {
  return () => {
    const { audience, count } = handle.props;
    const locale = handle.props.locale ?? "en";
    const heading = t`Palamedes is active in the browser`;
    const increment = t`Add a browser message`;

    return (
      <>
        <div className="grid">
          <TicketPanel quantity={handle.props.quantity ?? 1} />
          <ProofPanel
            message={handle.props.serverMessage ?? t`Server handler confirmed locale ${locale}.`}
            refreshing={handle.props.refreshing ?? false}
            failed={handle.props.serverFailed ?? false}
          />
        </div>
        <details className="feat" data-testid="remix-runtime-proof">
          <summary data-testid="remix-proof-toggle">Remix · {t`Behind the scenes`}</summary>
          <section aria-labelledby="client-proof-heading">
            <h2 data-testid="client-heading" id="client-proof-heading">
              {heading}
            </h2>
            <p data-testid="client-rich-message">
              <Trans>
                Open the <a href={handle.props.framesHref ?? "/frames"}>Remix client guide</a>.
              </Trans>
            </p>
            <p data-testid="client-plural-message">
              <Plural value={count} one="# browser message" other="# browser messages" />
            </p>
            <p data-testid="client-select-message">
              <Select
                value={audience}
                developer="Built for developers"
                other="Built for everyone"
              />
            </p>
            <button className="cta" data-testid="client-increment" type="button">
              {increment}
            </button>
            {handle.props.lazyText ? (
              <p data-testid="client-lazy-message">{handle.props.lazyText}</p>
            ) : (
              <button
                className="cta"
                data-testid="client-load-lazy"
                type="button"
              >{t`Open lazy feature`}</button>
            )}
          </section>
        </details>
      </>
    );
  };
}
