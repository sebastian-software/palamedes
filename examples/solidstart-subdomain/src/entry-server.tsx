import { createHandler, StartServer } from "@solidjs/start/server"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { locales } from "./lib/i18n"

export default createHandler((context) => {
  const { locale } = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader: context.request.headers.get("accept-language"),
    requestHost: context.request.headers.get("host"),
  })
  serverI18nScope.activate(createServerI18n(locale))
  return (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html lang="en">
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
      )}
    />
  )
})
