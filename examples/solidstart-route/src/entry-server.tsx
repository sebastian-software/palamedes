import { createHandler, StartServer } from "@solidjs/start/server"
import { createServerI18n, serverI18nScope } from "./lib/i18n.server"
import { normalizeLocale } from "./lib/i18n"

export default createHandler((context) => {
  const locale = normalizeLocale(
    new URL(context.request.url).pathname.split("/").filter(Boolean)[0]
  )
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
