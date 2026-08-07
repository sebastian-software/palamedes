import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import appCss from "@palamedes/example-ui/styles.css?url"
import { normalizeLocale } from "../lib/i18n"

export const Route = createRootRoute({
  loader({ location }) {
    const locale = location.pathname.split("/").filter(Boolean)[0]
    return normalizeLocale(locale)
  },
  head: () => ({
    meta: [
      { charSet: "utf8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Frontend Stage · Palamedes + TanStack Start" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const locale = Route.useLoaderData()

  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
