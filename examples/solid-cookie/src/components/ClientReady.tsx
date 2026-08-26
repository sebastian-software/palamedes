import { createSignal, onSettled, Show } from "solid-js"
import { isServer } from "@solidjs/web"
import { Trans } from "@palamedes/solid/macro"

export function ClientReady() {
  const [ready, setReady] = createSignal(false)

  onSettled(() => {
    if (!isServer) {
      setReady(true)
    }
  })

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
