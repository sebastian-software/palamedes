import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { activateLocale } from "./i18n"
import "./styles.css"

activateLocale("en")

const root = document.querySelector("#root")
if (!root) {
  throw new Error("Missing #root element")
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
