import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/root";
import { DEFAULT_LOCALE, resolveLocaleFromRequest } from "~/lib/i18n";
import "@palamedes/example-ui/styles.css";

export async function loader({ request }: Route.LoaderArgs) {
  return {
    locale: resolveLocaleFromRequest(request).locale,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData = useRouteLoaderData<typeof loader>("root");
  const locale = loaderData?.locale ?? DEFAULT_LOCALE;

  return (
    <html lang={locale}>
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
