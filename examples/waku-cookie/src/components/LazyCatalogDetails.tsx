"use client";

import { t } from "@palamedes/core/macro";

export default function LazyCatalogDetails() {
  return <p data-testid="lazy-catalog-details">{t`Lazy catalog detail loaded.`}</p>;
}
