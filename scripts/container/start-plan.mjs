// Pure helpers for the container supervisor. Kept separate from start-all.mjs so
// the host-binding override logic can be unit-tested without spawning servers.

// Every example server must listen on 0.0.0.0 inside the container so an external
// reverse proxy can reach the published container ports.
export const CONTAINER_HOST = "0.0.0.0"

// Some examples bind to 127.0.0.1 by default: SolidStart via `startEnv.HOST` in
// the matrix (overridden via HOST env below) and TanStack via `vite preview
// --host 127.0.0.1` (handled specially in buildStartArgs). We never edit the
// example package.json files; the container-only overrides live here and are
// applied on top of the shared EXAMPLE_MATRIX.
export function extraStartArgsFor(framework) {
  switch (framework) {
    case "nextjs":
      // `next start` already binds 0.0.0.0, but make it explicit.
      return ["-H", CONTAINER_HOST]
    default:
      // SolidStart (vinxi) honors HOST; react-router-serve defaults to 0.0.0.0 and
      // honors HOST too. Waku is expected to honor HOST / bind 0.0.0.0 — verify
      // external reachability of 4030/4031 when running the container. TanStack is
      // handled in buildStartArgs. No CLI override needed here.
      return []
  }
}

// Build the `pnpm` arguments for an example's start script.
//
// TanStack is special-cased: its `preview` script hardcodes `--host 127.0.0.1`,
// and appending a second `--host` does NOT reliably override it — Vite's CLI
// parser (cac) collects repeated flags into an array, which breaks
// `server.listen`. We instead run `vite preview` directly with a single
// host/port, leaving the example package.json untouched. For every other
// framework we run the matrix start script and append any host override after a
// `--` separator so pnpm forwards it to the underlying command.
export function buildStartArgs(example) {
  if (example.framework === "tanstack") {
    return ["exec", "vite", "preview", "--host", CONTAINER_HOST, "--port", String(example.port)]
  }
  const extra = extraStartArgsFor(example.framework)
  if (extra.length === 0) {
    return [...example.start]
  }
  return [...example.start, "--", ...extra]
}

// Build the environment for an example's start script: the base environment,
// then the matrix `startEnv`, then the container overrides (HOST forced to
// 0.0.0.0, PORT pinned to the example's fixed port).
//
// Note: react-router's start script sets PORT inline (`PORT=4041
// react-router-serve …`), which takes precedence over the PORT set here for that
// framework. Keep the matrix port and the react-router script port in sync.
export function buildStartEnv(example, baseEnv = {}) {
  return {
    ...baseEnv,
    ...example.startEnv,
    HOST: CONTAINER_HOST,
    PORT: String(example.port),
  }
}
