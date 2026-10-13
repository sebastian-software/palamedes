import { t } from "@palamedes/core/macro";

export function checkoutLabel() {
  return t({ message: "Buy now", context: "checkout button" });
}
