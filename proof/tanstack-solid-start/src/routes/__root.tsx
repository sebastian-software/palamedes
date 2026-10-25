import { createRootRoute, HeadContent, Scripts } from "@tanstack/solid-router";
import type { JSX } from "@solidjs/web";
import { documentLocale } from "../server-functions";
export const Route = createRootRoute({
  loader: () => documentLocale(),
  head: () => ({
    meta: [
      { charset: "utf8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Palamedes TanStack Solid Start" },
    ],
  }),
  shellComponent: RootDocument,
});
function RootDocument(props: { children: JSX.Element }) {
  const locale = Route.useLoaderData();
  return (
    <html lang={locale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
