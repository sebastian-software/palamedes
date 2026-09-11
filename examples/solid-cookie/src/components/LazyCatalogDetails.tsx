import { t } from "@palamedes/core/macro";

if (typeof document !== "undefined") document.documentElement.dataset.solidLazyBody = "executed";

export default function LazyCatalogDetails() {
  return <p data-testid="lazy-catalog-details">{t`Lazy catalog detail loaded.`}</p>;
}
