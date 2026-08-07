import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import appCss from "@palamedes/example-ui/styles.css?url"
import { loadDocumentLocale } from "../lib/server-functions"

export const Route = createRootRoute({
  loader: () => loadDocumentLocale(),
  head: () => ({
    meta: [
      { charSet: "utf8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Frontend Stage · Palamedes + TanStack Start (Subdomain)" },
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
