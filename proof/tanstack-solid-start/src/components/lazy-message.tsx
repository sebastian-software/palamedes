import { t } from "@palamedes/core/macro";
export default function LazyMessage() {
  return <output data-testid="lazy-message">{t`Lazy browser fragment confirmed locale.`}</output>;
}
