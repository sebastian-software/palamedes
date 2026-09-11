import { t } from "@palamedes/core/macro";

// Browser proof: a rejected catalog dependency must prevent this module body.
document.documentElement.dataset.remixLazyBody = "executed";

export function lazyMessage(): string {
  return t`This message arrived after the page was ready`;
}
