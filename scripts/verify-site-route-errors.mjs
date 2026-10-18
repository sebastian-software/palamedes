export function isExpectedSkippedViewTransitionError(channel, error) {
  return (
    channel === "pageerror" &&
    error?.name === "AbortError" &&
    error.message === "Transition was skipped"
  );
}

// ARDO omits generated-page breadcrumbs during SSR, then inserts them on the client.
// Keep this existing exception shared by the route and accessibility checks.
export function isKnownArdoBreadcrumbHydrationWarning(path, message) {
  return (
    isArdoGeneratedContentRoute(path) &&
    message.includes("Minified React error #418") &&
    message.includes("args[]=HTML")
  );
}

function isArdoGeneratedContentRoute(path) {
  return (
    path === "/docs" ||
    path.startsWith("/docs/") ||
    path === "/decisions" ||
    path.startsWith("/decisions/") ||
    path === "/api-reference" ||
    path.startsWith("/api-reference/") ||
    path.startsWith("/blog/")
  );
}
