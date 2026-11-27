# Security Policy

Palamedes is build-time, CLI, and runtime i18n infrastructure across TypeScript/JavaScript
applications and SSR framework adapters, native Rust CLI tooling (`pmds`), and published
Rust SDK crates (`palamedes`, `palamedes-i18n`, `palamedes-build`). Report security issues
privately so maintainers can assess and fix them before public disclosure.

## Supported versions

Security fixes are provided for the latest release on the default branch. Older
releases are not patched separately — upgrade to the latest version to receive a
fix.

## Reporting a vulnerability

Report suspected vulnerabilities privately. Do not open a public issue, pull
request, or discussion for a vulnerability that has not been fixed yet.

Two private channels are available:

- **GitHub private vulnerability reporting** — open this repository's
  **Security** tab and choose **Report a vulnerability**.
- **Email** — security@sebastian-software.de.

Include a concise description, the affected package or crate and version or commit,
environment details, reproduction steps, the impact you expect, whether the
issue is already public, and any suggested fix. Leave out credentials and data
you are not allowed to share.

## Response expectations

Maintainers aim to:

- Acknowledge a private report within 7 days.
- Assess severity and affected versions within 14 days.
- Coordinate a fix and a disclosure timeline with the reporter.
- Credit the reporter when desired and appropriate.

Timing can vary for low-impact reports and for reports that depend on a fix in
an upstream dependency.

## Scope

In scope: anything in this repository that lets someone read, modify, or execute
something they should not — including the released npm packages, published crates,
native binaries, and build and release automation. The security-relevant areas of
Palamedes are:

- macro transformation, `<Trans>` rendering/escaping, and generated JavaScript/TypeScript runtime code
- `.po` and `.fcl` catalog parsing, auditing, merging, and compilation (JavaScript and Rust targets)
- SSR framework adapters (`@palamedes/vite-plugin`, `@palamedes/next-plugin`, `@palamedes/remix`, `@palamedes/waku`, `@palamedes/tanstack`, `@palamedes/react-router`, `@palamedes/solid`), client catalog bootstrap/delivery, CSP nonce handling, and `@palamedes/core/locale` host, URL, and cookie handling
- published Rust SDK crates (`palamedes`, `palamedes-i18n`, `palamedes-build`) and external `.pmd.json` catalog loading and contract validation
- native N-API binding loading (`@palamedes/core-node`) and platform binary distribution
- `pmds` CLI commands that read or write project files and the `pmds` binary plugin execution boundary (`plugins:` in `palamedes.yaml`)
- GitHub Actions release, publish, and trusted-publishing automation

See [docs/security.md](./docs/security.md) for deployment hardening guidance and
documented trust boundaries (including why already-compiled JS catalog modules and
explicitly configured `pmds` binary plugins are treated as trusted local code).

Usually out of scope: reports without a concrete impact path, vulnerabilities in
third-party dependencies used as documented, issues resulting from bypassing
documented trust boundaries (such as importing an untrusted precompiled `.mjs`
catalog module or explicitly configuring an untrusted CLI binary plugin —
parser, compiler, or escaping defects in Palamedes's own `.po`/`.fcl` toolchain
remain in scope), and problems that require an already-compromised machine or a
deliberately corrupted local state.

## Disclosure

Public disclosure waits until a patched version is available, unless there is an
active public exploit.

Confirmed vulnerabilities are disclosed through:

- **GitHub Security Advisories (GHSA)** published on this repository, with **CVE**
  identifiers requested through GitHub when applicable
- **RustSec Advisory Database (`RUSTSEC`)** submissions for vulnerabilities affecting
  the published Rust crates (`palamedes`, `palamedes-i18n`, `palamedes-build`)
