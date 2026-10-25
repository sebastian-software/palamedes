# React Router RSC Cookie Fixture

Production-built proof for `@palamedes/react-router-rsc`. It uses the unstable
React Router RSC Framework Mode plugin, a custom `app/entry.rsc.tsx`, and a
real client-to-server top-level `"use server"` call. The resolver reads the
original cookie/Accept-Language request headers and loads one active-locale
server catalog. English, German, and French are available through the locale
selector, a saved cookie, or browser language negotiation.

Run `pnpm verify:react-router-rsc` from the repository root.
The production verifier sends a realistic multi-cookie request and forces two
German and French Server Function POSTs through the inert-by-default test
rendezvous before accepting their response markers. It also checks French SSR, lazy browser
fragments, locale switching, and catalog-failure recovery.
