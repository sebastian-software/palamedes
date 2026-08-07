import { createSignal, onMount, Show } from "solid-js"
import { Trans } from "@palamedes/solid/macro"

export function ClientReady() {
  const [ready, setReady] = createSignal(false)

  onMount(() => setReady(true))

  return (
    <Show when={ready()}>
      <span data-testid="client-ready" hidden>
        ready
      </span>
      <span data-testid="client-locale-value" hidden>
        <Trans>Add to cart</Trans>
      </span>
    </Show>
  )
}
