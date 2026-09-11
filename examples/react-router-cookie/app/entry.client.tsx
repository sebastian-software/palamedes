import { startTransition, StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { prepareReactRouterCatalogDelivery } from "@palamedes/vite-plugin/react-router-client";
import { DEFAULT_LOCALE, LOCALES, initializeClientI18n, type Locale } from "~/lib/i18n";

declare global {
  interface Window {
    __PALAMEDES_LOCALE__?: string;
  }
}

function bootstrap() {
  const candidate = window.__PALAMEDES_LOCALE__;
  const locale: Locale = LOCALES.includes(candidate as Locale)
    ? (candidate as Locale)
    : DEFAULT_LOCALE;
  initializeClientI18n(locale);

  void prepareReactRouterCatalogDelivery().then(
    () => startTransition(() => {
      hydrateRoot(document, <StrictMode><HydratedRouter /></StrictMode>);
    }),
    () => startTransition(() => {
      createRoot(document.body).render(<StrictMode><CatalogDeliveryError /></StrictMode>);
    }),
  );
}

function CatalogDeliveryError() {
  return (
    <main data-testid="catalog-delivery-error" role="alert">
      <h1>Catalog delivery failed</h1>
      <p>The localized resources could not be loaded.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload</button>
    </main>
  );
}

bootstrap();
