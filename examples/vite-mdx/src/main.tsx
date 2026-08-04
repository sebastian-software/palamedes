import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { initializeDocumentLocale, resolveDocumentLocale } from "./i18n"
import "./styles.css"

const locale = resolveDocumentLocale()
initializeDocumentLocale(locale)

const root = document.querySelector("#root")
if (!root) {
  throw new Error("Missing #root element")
}

createRoot(root).render(
  <StrictMode>
    <App locale={locale} />
  </StrictMode>
)
