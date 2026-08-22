# ADR-027: Privacy-Bounded CLI Update Check With Deployment-Gated Rollout

- Status: Accepted; rollout gated on endpoint readiness
- Date: 2026-08-22
- Issue: [#855](https://github.com/sebastian-software/palamedes/issues/855)

## Context

The native CLI cannot currently tell a user that a newer release exists. A
small update request can answer that question and provide aggregate evidence
about versions and platforms that make update checks. It is also a
trust-sensitive network side effect: an automatic request can reveal more than
its JSON body through application logging, stable identifiers, repeated
attempts, or accidental command and filesystem context.

The proposed endpoint did not exist when this decision was implemented.
`version.palamedes.dev/check` had no valid TLS service, and the repository's
website is a static GitHub Pages deployment rather than an application backend.
Shipping a hard-coded call to that hostname would therefore add a broken
network request and falsely imply that the server-side privacy contract was in
operation.

The no-identifier boundary has one important measurement consequence. A
24-hour client cache rate-limits requests from one installation, but the server
cannot recognize that installation again on a later day. Weekly unique active
installations are therefore not derivable. The honest measurements are
rate-limited request volume and version, OS, architecture, and CI/local
distributions.

## Decision

The native `pmds` binary owns one advisory update-check mechanism:

1. It starts only after Clap has accepted a regular subcommand. There is no
   daemon, service, postinstall hook, or separate scheduled process.
2. Release builds enable the mechanism only when
   `PALAMEDES_UPDATE_ENDPOINT` is exactly the owned HTTPS Worker route
   `https://version.palamedes.dev/check`. Missing values keep it disabled;
   malformed, alternate-origin, credentialed, port-qualified, query, or
   fragment values fail the build. The release workflow must not set that
   build variable until the production endpoint passes the readiness checklist
   in `services/update-check/README.md`.
3. `DO_NOT_TRACK=1` and `PALAMEDES_UPDATE_CHECK=0` disable the mechanism before
   cache or network access.
4. A platform cache records an attempted check before network I/O. Linux uses
   `$XDG_CACHE_HOME` with `$HOME/.cache` fallback, macOS uses
   `$HOME/Library/Caches`, and Windows uses `%LOCALAPPDATA%`. An atomic
   directory claim prevents concurrent processes from producing more than one
   request in the same 24-hour window. Missing, corrupt, or unwritable cache
   state never fails the command; if the rate limit cannot be recorded, the
   request is skipped.
5. The HTTPS POST body contains exactly the CLI version, Rust target OS, Rust
   target architecture, and a CI boolean. It contains no installation ID,
   telemetry ID, command, arguments, current directory, project path, config,
   hostname, username, or other application identifier.
6. Redirects are disabled and the entire request/response operation has a
   two-second deadline. The response body is limited to 4 KiB. The check runs
   beside the command; joining it can add only the remainder of that deadline
   to a due fast command. Offline, invalid, oversized, failed, or panicked
   checks are silent and cannot affect the command's exit code.
7. A strictly newer semantic version produces one short notice on stderr after
   command output. Stdout, including JSON output, remains unchanged.

The repository owns a small Cloudflare Worker contract under
`services/update-check`. It accepts exactly the four documented JSON fields,
reads the release version from its required `LATEST_VERSION` deployment
variable, and writes only those dimensions plus a count to Workers Analytics
Engine. Application code does not access or persist client IP addresses,
forwarded headers, user agents, or other identifying headers. It reads the
request URL path, `Content-Type`, and `Content-Length` only for route,
media-type, and body-size validation; none of that protocol metadata is written
to Analytics Engine or application logs. The checked configuration disables
Worker observability. Cloudflare still necessarily processes network metadata
as infrastructure; the application contract is that Palamedes does not persist
or query it.

The Worker is locally testable without Cloudflare credentials. Deployment,
DNS/TLS, dataset provisioning, release-version synchronization, and live
privacy verification remain explicit external readiness work. Until that work
is complete, the default release build makes no request and this issue must not
be described as a deployed service.

## Alternatives Considered

### Hard-code the proposed endpoint before deployment

Rejected. A non-fatal failure is still an undisclosed, predictably broken
network side effect and cannot prove the server privacy contract.

### Use npm or GitHub directly

Rejected. That would move the request to a third party, would not implement the
self-controlled aggregation contract, and would make its data-retention policy
part of CLI behavior.

### Add a stable anonymous installation identifier

Rejected. It would make weekly unique counts possible but violates the chosen
minimal-data contract and materially increases fingerprinting and disclosure
risk.

### Count IP addresses as installations

Rejected. NAT, dynamic addressing, VPNs, and CI make the measure inaccurate,
and retaining IP-derived identity contradicts the privacy requirement.

### Detach the request and let the process exit

Rejected. A detached thread has no delivery or notice guarantee once a short
CLI process exits. The bounded join makes ownership explicit and caps the only
possible delay at the documented two-second deadline.

## Consequences

- Update notices and aggregate request evidence share one small, explicit
  protocol without creating general CLI telemetry.
- Opt-outs, stream separation, rate limiting, concurrency, time, transport,
  semantic-version comparison, and server validation have deterministic tests.
- An offline due check is not retried until the next 24-hour window. This favors
  bounded impact over maximizing observations.
- A release build with no endpoint has no cache or network side effect.
- Request volume is a usage proxy, not a unique-installation count.
- Adding TLS/HTTP code to the shipped CLI must remain within the separate
  `pmds` binary-size ceiling and be remeasured on the release profile.
