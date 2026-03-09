import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { i18n } from "@lingui/core"
import { I18nProvider } from "@lingui/react"
import { App } from "./App"
import { messages as enMessages } from "./locales/en.po"

// Initialize with English
i18n.load("en", enMessages)
i18n.activate("en")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>
  </StrictMode>
)
