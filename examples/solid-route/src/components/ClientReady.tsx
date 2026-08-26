import { createSignal, onSettled, Show } from "solid-js"
import { isServer } from "@solidjs/web"

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
    </Show>
  )
}
