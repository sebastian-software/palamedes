import type { Reroute } from "@sveltejs/kit/hooks";

// Locale prefixes select the same route components without rewriting the URL.
export const reroute: Reroute = ({ url }) =>
  url.pathname.replace(/^\/(en|de|es|fr)(?=\/|$)/u, "") || "/";
