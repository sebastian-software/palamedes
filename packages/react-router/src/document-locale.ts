import { createContext } from "react";

/**
 * The locale `handleRequest` renders the document for. It is set even when no
 * route loader ran, such as for 404 and 405 documents and catalog failures.
 */
export const DocumentLocaleContext = createContext<string | undefined>(undefined);
