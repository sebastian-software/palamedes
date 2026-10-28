import { useDocumentLocale } from "@palamedes/react-router/document";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import { DEFAULT_LOCALE } from "~/lib/i18n";
import { i18n } from "~/lib/i18n.server";
import { serverI18nTestBarrier } from "~/lib/test-barrier.server";
import "@palamedes/example-ui/styles.css";

export const middleware: Route.MiddlewareFunction[] = [i18n.middleware, serverI18nTestBarrier];

export function Layout({ children }: { children: React.ReactNode }) {
  const locale = useDocumentLocale() ?? DEFAULT_LOCALE;

  return (
    <html lang={locale} data-palamedes-time-zone="Europe/Berlin">
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
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  return (
    <main role="alert">
      <h1>This page is temporarily unavailable.</h1>
      <p>Reload the page to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>{" "}
      <a href="/">Go home</a>
    </main>
  );
}
