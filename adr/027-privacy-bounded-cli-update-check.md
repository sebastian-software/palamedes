# ADR-027: Privacy-Bounded CLI Update Check With Deployment-Gated Rollout

- Status: Accepted; rollout gated on endpoint readiness
- Date: 2026-08-22 (amended 2026-08-27: shared service, project and cohort
  fields — [#1036](https://github.com/sebastian-software/palamedes/issues/1036))
- Issue: [#855](https://github.com/sebastian-software/palamedes/issues/855)

## Context

The native CLI cannot currently tell a user that a newer release exists. A
small update request can answer that question and provide aggregate evidence
about versions and platforms that make update checks. It is also a
trust-sensitive network side effect: an automatic request can reveal more than
its JSON body through application logging, stable identifiers, repeated
attempts, or accidental command and filesystem context.

The endpoint does not exist yet. `version.sebastian-software.dev/check` is the
agreed shared route for all Sebastian Software CLIs, owned by the public
[version-service](https://github.com/sebastian-software/version-service)
repository, and is not deployed. Shipping a hard-coded call to that hostname
before deployment would add a broken network request and falsely imply that
the server-side privacy contract was in operation.

The no-identifier boundary has one important measurement consequence. A
24-hour client cache rate-limits requests from one installation, but the server
cannot recognize that installation again on a later day. Weekly unique active
installations are therefore not derivable. The honest measurements are
rate-limited request volume, version, OS, architecture, and CI/local
distributions, and — through a coarse year-month install cohort — how many
older installations remain active.

## Decision

The native `pmds` binary owns one advisory update-check mechanism:

1. It starts only after Clap has accepted a regular subcommand. There is no
   daemon, service, postinstall hook, or separate scheduled process.
2. Release builds enable the mechanism only when
   `PALAMEDES_UPDATE_ENDPOINT` is exactly the owned HTTPS route
   `https://version.sebastian-software.dev/check`. Missing values keep it
   disabled; malformed, alternate-origin, credentialed, port-qualified, query,
   or fragment values fail the build. The release workflow must not set that
   build variable until the production endpoint passes the deployment guide in
   the version-service repository.
3. `DO_NOT_TRACK=1` and `PALAMEDES_UPDATE_CHECK=0` disable the mechanism before
   cache or network access.
4. A platform cache records an attempted check before network I/O. Linux uses
   `$XDG_CACHE_HOME` with `$HOME/.cache` fallback, macOS uses
   `$HOME/Library/Caches`, and Windows uses `%LOCALAPPDATA%`. An atomic
   directory claim prevents concurrent processes from producing more than one
   request in the same 24-hour window. Missing, corrupt, or unwritable cache
   state never fails the command; if the rate limit cannot be recorded, the
   request is skipped.
5. The HTTPS POST body contains exactly the project identifier (`palamedes`),
   the CLI version, Rust target OS, Rust target architecture, a CI boolean,
   and a year-month install cohort. It contains no installation ID, telemetry
   ID, command, arguments, current directory, project path, config, hostname,
   username, or other application identifier.
6. The install cohort is deliberately never finer than a month. Combined with
   the other payload dimensions, a day- or week-precision value could form
   singleton combinations whose daily requests become linkable across days — a
   de-facto identifier. The value is derived once, persisted beside the cache
   as `installed-since-v1`, validated on read, and recomputed when missing,
   malformed, or in the future. A deleted cache restarts the cohort.
7. Redirects are disabled and the entire request/response operation has a
   two-second deadline. The response body is limited to 4 KiB. The check runs
   beside the command; joining it can add only the remainder of that deadline
   to a due fast command. Offline, invalid, oversized, failed, or panicked
   checks are silent and cannot affect the command's exit code.
8. A strictly newer semantic version produces one short notice on stderr after
   command output. Stdout, including JSON output, remains unchanged.

The server half is a shared, multi-project endpoint owned by the public
[version-service](https://github.com/sebastian-software/version-service)
repository: a Bunny Edge Scripting script that validates the documented JSON
fields against a per-project allowlist, answers with the latest released
version read from the project's distribution registry (cached briefly
server-side; publishing a release is the synchronization), and forwards only
the documented aggregate dimensions to the self-hosted Rybbit analytics
instance with neutralized IP and user-agent values. Application code does not
access or persist client IP addresses, forwarded headers, user agents, or
other identifying headers. It reads the request URL path, `Content-Type`, and
`Content-Length` only for route, media-type, and body-size validation; none of
that protocol metadata reaches the analytics sink or application logs. The
edge platform still necessarily processes network metadata as infrastructure;
the application contract is that we do not persist or query it. The sink is
swappable behind the stable wire contract without rebuilding any client.

Deployment, DNS/TLS, sink configuration, and live privacy verification remain
explicit external readiness work tracked in the version-service repository.
Until that work is complete, the default release build makes no request and
this issue must not be described as a deployed service.

## Alternatives Considered

### Hard-code the proposed endpoint before deployment

Rejected. A non-fatal failure is still an undisclosed, predictably broken
network side effect and cannot prove the server privacy contract.

### Let clients query npm or GitHub directly

Rejected for the client. That would move the request to a third party, would
not implement the self-controlled aggregation contract, and would make its
data-retention policy part of CLI behavior. The shared service does read the
distribution registry server-side as its version source — behind the owned
endpoint, where the retention contract stays ours.

### Per-project Cloudflare Worker with Workers Analytics Engine

Superseded (original decision of 2026-08-22). Cloudflare is not part of our
operated stack, and a per-repository service does not scale to the other CLIs.
The shared Bunny Edge Scripting service with the Rybbit sink replaces it; the
reviewed request-validation contract carried over unchanged.

### Add a stable anonymous installation identifier

Rejected. It would make weekly unique counts possible but violates the chosen
minimal-data contract and materially increases fingerprinting and disclosure
risk. Identified telemetry, if ever wanted, is
[#856](https://github.com/sebastian-software/palamedes/issues/856) as an
explicit opt-in with its own decision.

### Send a day-precision install date

Rejected. Roughly 365 values per year multiplied with the version, OS, and
architecture dimensions produce singleton cells; a singleton that pings daily
is trackable without any explicit identifier. Year-month buckets keep the
cohort signal while individuals stay inside their cohort.

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
  cohort derivation, and semantic-version comparison have deterministic tests;
  server validation is tested in the version-service repository.
- An offline due check is not retried until the next 24-hour window. This favors
  bounded impact over maximizing observations.
- A release build with no endpoint has no cache or network side effect.
- Request volume is a usage proxy, not a unique-installation count; the
  year-month cohort adds a retention signal without an identifier.
- The service and its deployment guide live outside this repository; changing
  the endpoint host requires a coordinated build-allowlist update here.
- Adding TLS/HTTP code to the shipped CLI must remain within the separate
  `pmds` binary-size ceiling and be remeasured on the release profile.
