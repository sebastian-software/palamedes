import { createDemoLocalePolicy } from "../../packages/example-ui/dist/index.mjs";

// A blocking classic script selects the document locale before the module graph
// evaluates catalog imports. The same policy also runs in the SSR demos.
export function localeBootstrap() {
  const source = `const policy = (${createDemoLocalePolicy.toString()})(new URL(location.href), document.cookie, navigator.languages.join(','));\nif (policy.redirect) location.replace(policy.redirect);\ndocument.documentElement.lang = policy.locale;\n`;
  return {
    name: "demo-locale-bootstrap",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/locale.js") return next();
        res.setHeader("Content-Type", "text/javascript");
        res.end(source);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "locale.js", source });
    },
  };
}

export function demoHosts(framework) {
  return [
    `${framework}-cookie.examples.palamedes.dev`,
    `${framework}-route.examples.palamedes.dev`,
    ...["en", "de", "es", "fr"].map(
      (locale) => `${locale}.${framework}-subdomain.examples.palamedes.dev`,
    ),
    ...["com", "de", "es", "fr"].map((tld) => `${framework}.examples.palamedes-i18n.${tld}`),
  ];
}
