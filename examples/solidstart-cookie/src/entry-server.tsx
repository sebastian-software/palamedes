import { createHandler, StartServer } from "@solidjs/start/server"
import { getRequestEvent } from "solid-js/web"
import { resolveCookieLocale } from "./lib/server"

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => {
      const { locale } = resolveCookieLocale(getRequestEvent()?.request)

      return (
        <html lang={locale}>
          <head>
            <meta charset="utf-8" />
            <meta content="width=device-width, initial-scale=1" name="viewport" />
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )
    }}
  />
))
