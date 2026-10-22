import { useRequestURL } from "#imports";
import { useState as nuxtState } from "#app";
import { createDemoLocalePolicy } from "@palamedes/example-ui";

export function useDemoHref() {
  const locale = nuxtState<string>("palamedes.locale").value;
  const policy = createDemoLocalePolicy(new URL(useRequestURL().href));
  return (pathname: string) => {
    const target = new URL(policy.href(locale, pathname));
    return target.pathname + target.search + target.hash;
  };
}
