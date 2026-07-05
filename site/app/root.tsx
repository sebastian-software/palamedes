import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router"

import "./app.css"

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary() {
  return (
    <main className="frame px-8 py-16">
      <p className="micro text-gray-spec">Error</p>
      <h1 className="mt-4 text-h2 font-bold tracking-tight">Something went wrong.</h1>
      <p className="mt-4">
        <a className="text-accent underline" href="/">
          Back to the homepage
        </a>
      </p>
    </main>
  )
}
