import { createContext } from "react";

/** What `handleRequest` knows about the document it renders. */
export type DocumentState = {
  /** The request's locale, also for documents no route loader ran for, such as a 404. */
  readonly locale: string | undefined;
  /** Whether the request's server catalog loaded; `false` in the catalog-failure document. */
  readonly catalogAvailable: boolean;
};

export const DocumentStateContext = createContext<DocumentState | undefined>(undefined);

/**
 * Set on `<html>` of the catalog-failure document, so the browser renders the
 * same catalog-free markup during hydration.
 */
export const CATALOG_UNAVAILABLE_ATTRIBUTE = "data-palamedes-catalog-unavailable";
