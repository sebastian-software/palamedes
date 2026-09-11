"use client";

import { t } from "@palamedes/core/macro";

if (typeof window !== "undefined") {
  (
    globalThis as typeof globalThis & { __palamedesWakuLazyCatalogBody?: boolean }
  ).__palamedesWakuLazyCatalogBody = true;
}

export default function LazyCatalogDetails() {
  return <p data-testid="lazy-catalog-details">{t`Lazy catalog detail loaded.`}</p>;
}
