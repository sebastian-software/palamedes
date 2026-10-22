import type { Locale } from "../integration/locale";

declare global {
  namespace App {
    interface Locals {
      locale: Locale;
    }
  }
}

export {};
