// Pure helpers for the container supervisor. Kept separate from start-all.mjs so
// the host-binding override logic can be unit-tested without spawning servers.

// Every example server must listen on 0.0.0.0 inside the container so an external
// reverse proxy can reach the published container ports.
export const CONTAINER_HOST = "0.0.0.0"

// Host binding per framework (verified by running the container):
// - Next.js (`next start`), Waku (`waku start`) and react-router-serve all bind
//   0.0.0.0 already / honor the HOST env — no CLI override, just the HOST env.
// - SolidStart (vinxi) binds 127.0.0.1 via `startEnv.HOST` in the matrix; the
//   HOST env in buildStartEnv overrides it to 0.0.0.0.
// - TanStack binds 127.0.0.1 via a hardcoded `vite preview --host 127.0.0.1` in
//   its package script; handled specially in buildStartArgs.
// We never edit the example package.json files; the container-only overrides
// live here on top of the shared EXAMPLE_MATRIX.

// Build the `pnpm` arguments for an example's start script.
//
// TanStack is special-cased: its `preview` script hardcodes `--host 127.0.0.1`,
// and appending a second `--host` would NOT reliably override it — Vite's CLI
// parser (cac) collects repeated flags into an array, which breaks
// `server.listen`. We run `vite preview` directly with a single host/port
// instead, leaving the example package.json untouched. Every other framework
// runs its matrix start script unchanged and binds 0.0.0.0 via the HOST env
// (see buildStartEnv); appending a CLI host flag is unsafe (e.g. `next start`
// treats a trailing `-H` as a positional project directory).
export function buildStartArgs(example) {
  if (example.framework === "tanstack") {
    return ["exec", "vite", "preview", "--host", CONTAINER_HOST, "--port", String(example.port)]
  }
  return [...example.start]
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
