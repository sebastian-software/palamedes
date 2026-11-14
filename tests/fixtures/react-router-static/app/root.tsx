import { Outlet, Scripts, ScrollRestoration } from "react-router";
import { useDocumentLocale } from "@palamedes/react-router/document";
import { i18n } from "./i18n.server";
export const middleware = [i18n.middleware];
export default function App() {
  const locale = useDocumentLocale() ?? "en";
  return (
    <html lang={locale}>
      <head />
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
