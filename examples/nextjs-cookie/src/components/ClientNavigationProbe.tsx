"use client";

import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useState } from "react";
import { setLocaleAction } from "@/lib/actions";
import type { Locale } from "@/lib/i18n";

export function ClientNavigationProbe({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [prefetchInvalidated, setPrefetchInvalidated] = useState(false);
  const [repeatedLocale, setRepeatedLocale] = useState(false);

  return (
    <>
      <button
        data-testid="repeat-locale-choice"
        hidden
        onClick={async () => {
          await setLocaleAction(locale);
          setRepeatedLocale(true);
        }}
        type="button"
      >
        Repeat current locale choice
      </button>
      <output data-testid="repeat-locale-result" hidden>
        {String(repeatedLocale)}
      </output>
      <button
        data-testid="prefetch-lazy-client-probe"
        hidden
        onClick={() =>
          router.prefetch("/lazy-client-probe", {
            kind: PrefetchKind.FULL,
            onInvalidate: () => setPrefetchInvalidated(true),
          })
        }
        type="button"
      >
        Prefetch lazy client probe
      </button>
      <output data-testid="prefetch-invalidated" hidden>
        {String(prefetchInvalidated)}
      </output>
      <button
        data-testid="open-lazy-client-probe"
        hidden
        onClick={() => router.push("/lazy-client-probe")}
        type="button"
      >
        Open lazy client probe
      </button>
    </>
  );
}
