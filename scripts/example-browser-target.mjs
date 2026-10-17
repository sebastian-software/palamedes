/** Resolve the one hosted proof that has a complete browser contract today. */
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
  if (plan.length !== 1 || plan[0].example.id !== "remix-cookie") {
    throw new Error(
      "--base-url requires --id remix-cookie; other hosted contracts are not defined.",
    );
  }
  return target.origin;
}
