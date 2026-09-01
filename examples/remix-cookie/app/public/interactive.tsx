import { t } from "@palamedes/core/macro"
import { Plural, Select, Trans } from "@palamedes/remix/macro"
import type { Handle, RemixNode } from "remix/ui"

export type ClientProofProps = {
  audience: "developer" | "other"
  count: number
}

/** Shared by SSR and the browser so Remix UI exercises its hydration path. */
export function ClientProof(handle: Handle<ClientProofProps>): () => RemixNode {
  return () => {
    const { audience, count } = handle.props
    const heading = t`Palamedes is active in the browser`
    const increment = t`Add a browser message`

    return (
      <section aria-labelledby="client-proof-heading">
        <h2 data-testid="client-heading" id="client-proof-heading">
          {heading}
        </h2>
        <p data-testid="client-rich-message">
          <Trans>
            Open the <a href="/frames">Remix client guide</a>.
          </Trans>
        </p>
        <p data-testid="client-plural-message">
          <Plural value={count} one="# browser message" other="# browser messages" />
        </p>
        <p data-testid="client-select-message">
          <Select value={audience} developer="Built for developers" other="Built for everyone" />
        </p>
        <button data-testid="client-increment" type="button">
          {increment}
        </button>
      </section>
    )
  }
}
