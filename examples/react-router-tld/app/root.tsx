import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { DEFAULT_LOCALE, resolveLocaleFromRequest } from "~/lib/i18n";
import "@palamedes/example-ui/styles.css";

declare global {
  interface Window {
    __PALAMEDES_LOCALE__?: string;
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  return {
    locale: resolveLocaleFromRequest(request),
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
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__PALAMEDES_LOCALE__=${JSON.stringify(locale)};`,
          }}
        />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary(_props: Route.ErrorBoundaryProps) {
  return (
    <main className="pt-16 p-4 container mx-auto" role="alert">
      <h1>This page is temporarily unavailable.</h1>
      <p>Reload the page to try again.</p>
      <a href="">Reload page</a>{" "}
      <a href="/">Go home</a>
    </main>
  );
}
