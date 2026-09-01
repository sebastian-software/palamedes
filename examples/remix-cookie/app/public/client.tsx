import { createI18n } from "@palamedes/core"
import { initializeRemixClientI18n } from "@palamedes/remix/client"
import { createRoot } from "remix/ui"

initializeRemixClientI18n({ createI18n })

const { ClientProof } = await import("./interactive.tsx")
const container = document.querySelector<HTMLElement>("[data-remix-client-proof]")
if (!container) {
  throw new Error("Missing the server-rendered Remix client proof root.")
}

let count = 1
const root = createRoot(container)
const render = () => root.render(<ClientProof audience="developer" count={count} />)

container.addEventListener("click", (event) => {
  const target = event.target
  if (!(target instanceof Element) || !target.closest('[data-testid="client-increment"]')) {
    return
  }

  count += 1
  render()
})

render()

const ready = document.createElement("span")
ready.dataset.testid = "client-ready"
ready.hidden = true
document.body.append(ready)
