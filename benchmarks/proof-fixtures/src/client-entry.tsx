import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ClientApp } from "./client-app"

const container = document.getElementById("root")

if (container) {
  createRoot(container).render(
    <StrictMode>
      <ClientApp name="Palamedes" />
    </StrictMode>,
  )
}
