import { getI18n } from "@palamedes/runtime"
import { Links, Meta, Outlet } from "react-router"

// React Router bundles the root layout into the client graph as well, and this
// fixture installs i18n on the server only. So the locale comes from the active
// request scope while rendering, and from the attribute that render produced
// while hydrating — same value on both sides, and no client i18n required.
function documentLocale() {
  return typeof document === "undefined" ? getI18n().locale : document.documentElement.lang
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={documentLocale()}>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <Meta />
        <Links />
      </head>
      <body>{children}</body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}
