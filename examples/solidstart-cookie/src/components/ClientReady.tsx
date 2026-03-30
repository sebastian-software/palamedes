import { createSignal, onMount, Show } from "solid-js"

export function ClientReady() {
  const [ready, setReady] = createSignal(false)

  onMount(() => setReady(true))

  return (
    <Show when={ready()}>
      <span data-testid="client-ready" hidden>
        ready
      </span>
    </Show>
  )
}
