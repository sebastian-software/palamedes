import { getI18n } from "@palamedes/runtime"
import { Links, Meta, Outlet } from "react-router"

export function Layout({ children }: { children: React.ReactNode }) {
  // The custom RSC entry runs this render inside the request scope, so the
  // active instance carries the locale this document was negotiated for.
  const { locale } = getI18n()

  return (
    <html lang={locale}>
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
