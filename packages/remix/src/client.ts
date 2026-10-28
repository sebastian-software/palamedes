import {
  createI18n,
  defineCompiledCatalog,
  isCompiledCatalog,
  type CompiledCatalogMessages,
  type PalamedesI18n,
} from "@palamedes/core";
import { isServerEnvironment, loadRegisteredMessages, setClientI18n } from "@palamedes/runtime";

const initializedDocuments = new WeakMap<
  RemixClientDocument,
  { catalogVersion: string; i18n: PalamedesI18n; locale: string }
>();

/** The document fields the client reads to verify the server-rendered locale. */
export type RemixClientDocument = {
  documentElement: {
    lang: string;
  };
};

export type RemixClientCatalogModule<TLocale extends string = string> = {
  locale: TLocale;
  catalogVersion: string;
  messages: CompiledCatalogMessages;
};

export type InitializeRemixClientI18nAsyncOptions<
  TLocale extends string,
  T extends PalamedesI18n,
> = {
  createI18n: () => T;
  /** Defaults to the browser document; used to verify `<html lang>`. */
  document?: RemixClientDocument;
  catalogUrl?: string;
  loadCatalog?: () => Promise<unknown>;
  catalog?: unknown;
};

/** Load and install an adapter-owned executable catalog ESM asset. */
export async function initializeRemixClientI18nAsync<
  TLocale extends string,
  T extends PalamedesI18n,
>(options: InitializeRemixClientI18nAsyncOptions<TLocale, T>): Promise<T> {
  if (isServerEnvironment()) {
    throw new Error("Palamedes Remix client catalog assets can only run in a browser environment.");
  }

  let loaded: unknown;
  try {
    if (options.catalog !== undefined) {
      loaded = options.catalog;
    } else if (options.loadCatalog) {
      loaded = await options.loadCatalog();
    } else if (options.catalogUrl) {
      loaded = await import(/* @vite-ignore */ options.catalogUrl);
    } else {
      throw new TypeError(
        "Provide catalogUrl, loadCatalog, or catalog from remixI18n.renderClientCatalog(locale).",
      );
    }
  } catch (error) {
    throw new Error("Palamedes Remix executable catalog asset could not be loaded.", {
      cause: error,
    });
  }

  const module = validateCatalogModule<TLocale>(loaded);
  const initialized = installCatalog(options, module);
  await loadRegisteredMessages(initialized, module.locale);
  return initialized;
}

/** Start an application entry after the document's executable catalog is ready.
 * The optional error markup belongs to the host and must not depend on translations.
 */
export async function startRemixClient(
  loadEntry: () => Promise<unknown>,
  options: { errorHtml?: string } = {},
): Promise<void> {
  let failed = false;
  const renderFailure = async (): Promise<void> => {
    if (failed) return;
    failed = true;
    if (!document.body) {
      await new Promise<void>((resolve) =>
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }),
      );
    }
    const template = document.createElement("template");
    template.innerHTML =
      options.errorHtml ??
      '<main role="alert"><h1>Something went wrong</h1><p>Please reload the page to try again.</p><button type="button" data-palamedes-reload>Reload</button><a href="/">Home</a></main>';
    document.body.replaceChildren(template.content.cloneNode(true));
    document
      .querySelector("[data-palamedes-reload]")
      ?.addEventListener("click", () => window.location.reload());
  };
  window.addEventListener("palamedes:catalog-error", () => {
    void renderFailure();
  });
  try {
    const catalogLink = document.querySelector<HTMLLinkElement>(
      "link[data-palamedes-catalog-locale]",
    );
    if (!catalogLink) throw new Error("Palamedes Remix document catalog is missing.");
    await initializeRemixClientI18nAsync({
      createI18n: () =>
        createI18n({
          timeZone: document.documentElement.dataset?.palamedesTimeZone,
        }),
      catalogUrl: catalogLink.href,
    });
    await loadEntry();
  } catch {
    await renderFailure();
  }
}

function validateCatalogModule<TLocale extends string>(
  value: unknown,
): RemixClientCatalogModule<TLocale> {
  const candidate =
    isPlainObject(value) && isPlainObject(value.default) ? { ...value, ...value.default } : value;
  if (!isPlainObject(candidate)) {
    throw new TypeError("Palamedes Remix executable catalog asset must export an object.");
  }
  if (typeof candidate.locale !== "string" || candidate.locale.length === 0) {
    throw new TypeError("Palamedes Remix executable catalog asset has no locale export.");
  }
  if (typeof candidate.catalogVersion !== "string" || candidate.catalogVersion.length === 0) {
    throw new TypeError("Palamedes Remix executable catalog asset has no catalogVersion export.");
  }
  const fragmentRegistry =
    (isPlainObject(value) && value.fragmentRegistry === true) ||
    candidate.fragmentRegistry === true;
  const messages =
    fragmentRegistry &&
    isPlainObject(candidate.messages) &&
    Object.keys(candidate.messages).length === 0
      ? defineCompiledCatalog({})
      : candidate.messages;
  if (!isCompiledCatalog(messages)) {
    throw new TypeError(
      `Palamedes Remix executable catalog asset for locale "${candidate.locale}" does not contain a compiled catalog.`,
    );
  }
  return {
    locale: candidate.locale as TLocale,
    catalogVersion: candidate.catalogVersion,
    messages,
  };
}

/**
 * Install the document's locale and catalog before browser-rendered translated
 * modules execute. Locale changes intentionally require a full document
 * navigation so the server and browser cannot disagree about the active
 * catalog.
 */
function installCatalog<TLocale extends string, T extends PalamedesI18n>(
  options: InitializeRemixClientI18nAsyncOptions<TLocale, T>,
  catalog: RemixClientCatalogModule<TLocale>,
): T {
  const document = options.document ?? getBrowserDocument();
  const documentLocale = document?.documentElement.lang;
  if (documentLocale === "") {
    throw new Error(
      `Palamedes Remix client catalog cannot verify locale "${catalog.locale}" because the document has no <html lang> attribute. Render <html lang={locale}> in the server document.`,
    );
  }
  if (documentLocale !== undefined && documentLocale !== catalog.locale) {
    throw new Error(
      `Palamedes Remix client catalog locale "${catalog.locale}" does not match document locale "${documentLocale}". Perform a full document navigation when changing locale.`,
    );
  }

  const initialized = document ? initializedDocuments.get(document) : undefined;
  if (initialized) {
    if (
      initialized.locale !== catalog.locale ||
      initialized.catalogVersion !== catalog.catalogVersion
    ) {
      throw new Error(
        `Palamedes Remix client cannot replace catalog "${initialized.catalogVersion}" for locale "${initialized.locale}" with catalog "${catalog.catalogVersion}" for locale "${catalog.locale}" in the same document. Perform a full document navigation.`,
      );
    }
    return initialized.i18n as T;
  }

  let i18n: T;
  try {
    i18n = options.createI18n();
    i18n.load(catalog.locale, catalog.messages);
    i18n.activate(catalog.locale);
  } catch (error) {
    throw new Error(
      `Palamedes Remix client could not install compiled catalog "${catalog.catalogVersion}" for locale "${catalog.locale}". Verify the executable catalog asset and its generated runtime.`,
      { cause: error },
    );
  }

  const installed = setClientI18n(i18n);
  if (document) {
    initializedDocuments.set(document, {
      catalogVersion: catalog.catalogVersion,
      i18n: installed,
      locale: catalog.locale,
    });
  }
  return installed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getBrowserDocument(): RemixClientDocument | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document as unknown as RemixClientDocument;
}
