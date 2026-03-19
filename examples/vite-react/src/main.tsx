import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { setClientI18n } from "@palamedes/runtime"
import { App } from "./App"
import { i18n } from "./i18n"
import { messages as enMessages } from "./locales/en.po"

// Initialize with English
i18n.load("en", enMessages)
i18n.activate("en")
setClientI18n(i18n)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
