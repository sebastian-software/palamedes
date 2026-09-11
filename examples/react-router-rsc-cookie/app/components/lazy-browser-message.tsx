"use client";

import { t } from "@palamedes/core/macro";

export default function LazyBrowserMessage() {
  return (
    <output data-testid="lazy-browser-message">{t`Lazy browser fragment confirmed locale.`}</output>
  );
}
