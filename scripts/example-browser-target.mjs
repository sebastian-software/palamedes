import { EXAMPLE_MATRIX } from "./example-matrix.mjs";

/** Resolve one hosted example without changing the local build/start lifecycle. */
export function resolveExternalBrowserTarget(argv, plan) {
  const indexes = argv.flatMap((value, index) =>
    value === "--base-url" || value.startsWith("--base-url=") ? [index] : [],
  );
  if (indexes.length === 0) return;
  if (indexes.length !== 1) throw new Error("Pass --base-url exactly once.");

  const option = argv[indexes[0]];
  const value = option === "--base-url" ? argv[indexes[0] + 1] : option.slice("--base-url=".length);
  if (!value || value.startsWith("--")) throw new Error("--base-url requires an origin.");
  const target = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (target.protocol !== "https:" && (target.protocol !== "http:" || !loopback)) {
    throw new Error("--base-url requires HTTPS, or HTTP on a loopback host for local proof.");
  }
  if (
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/"
  ) {
    throw new Error("--base-url must be an origin without credentials, path, query, or fragment.");
  }
  if (plan.length !== 1 || !EXAMPLE_MATRIX.some((entry) => entry.id === plan[0].example.id)) {
    throw new Error("--base-url requires exactly one explicit --id from the example matrix.");
  }
  const strategy = EXAMPLE_MATRIX.find((entry) => entry.id === plan[0].example.id).strategy;
  if (strategy === "subdomain" && !target.hostname.startsWith("en.")) {
    throw new Error("The subdomain proof starts at the final en.<example-host> origin.");
  }
  if (strategy === "tld" && !target.hostname.endsWith(".com")) {
    throw new Error("The TLD proof starts at the final .com origin and visits .de, .es, and .fr.");
  }
  return target.origin;
}
