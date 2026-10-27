# ADR-016: Independent Update Checks and Opt-In CLI Usage Reporting

**Status:** Accepted

**Last updated:** 2026-10-27

Palamedes v2 uses the shared Rust `app-tracking` client and service. Version
checks remain independent of optional usage reporting. The native `pmds`
entry point owns both calls; the npm launcher, Node/Rust APIs, framework
plugins, and application runtimes do not report automatically.

## Decision

- Release builds validate and embed the owned app-tracking version route.
  Ordinary source builds without that configuration make no network calls.
  Updates use the existing oss-metrics release snapshot through the service,
  accept only eligible GitHub releases at least one hour old, and do not send
  an installed version, installation ID, project hash, or usage payload.
- Usage reporting is off until an explicit decision after disclosure.
  `pmds telemetry enable` displays the notice without granting consent;
  `--accept telemetry-v1` records the affirmative decision. Existing
  version-service reporting is never imported as consent.
- Count one successfully parsed native command entering execution, regardless
  of its eventual exit status. Use a reviewed fixed command catalog; catalog
  operations have distinct categories. Help/version, telemetry controls,
  automatic Git merge-driver execution, and watch rebuilds are excluded.
  External plugins use a single `plugin` category without their names.
- Reports contain UTC day, tool/version, category, count, a tool/profile-scoped
  installation ID, consent metadata, local/CI scope, and an optional SHA-256
  project identifier from the normalized repository URL. Equivalent clones
  share the project hash across tools. Hashes are guessable and pseudonymous,
  not an anonymity guarantee. Arguments, content, paths, raw repository URLs,
  plugin names, and user/machine names are excluded.
- The shared client owns private state, bounded durable batches, retries,
  concurrent-process coordination, withdrawal, deletion, and expiry. `status`
  and `preview` send nothing. Disabling clears unsent reports; deletion stays
  visibly pending until the service acknowledges it. Lost credentials cannot
  authenticate remote deletion.
- `DO_NOT_TRACK=1` vetoes telemetry and preserves Palamedes' existing update
  opt-out. `PALAMEDES_UPDATE_CHECK=0` controls only updates;
  `PALAMEDES_TELEMETRY=off` controls collection/upload. Offline settings prevent
  networking, including deletion, but explicitly consented local counts can
  accumulate within the client's limits. CI needs separate informed opt-in
  and a private state directory unique to the job/run.
- Ordinary failures remain silent and advisory. Run invocation accounting and
  offer any update notice before command execution, so watch interruption does
  not bypass invocation accounting or advisory delivery. Watch rebuilds do not
  re-enter this lifecycle. Automatic updates require an interactive stderr
  terminal outside CI; `PALAMEDES_UPDATE_CHECK=1` explicitly enables checks in
  CI/noninteractive use without granting telemetry consent. Existing offline
  and do-not-track vetoes always win. No lossless counting is promised for a
  process killed before its local write or for state/queue failures.
  Persist telemetry locally and
  send one due operation in a short-lived background copy of the same binary;
  the command does not wait for network delivery. Its reserved worker entry
  runs before normal parsing, locale/config/plugin setup, update checks, and
  counting. It rechecks current policy and private state before sending.
  There is no permanent daemon or postinstall reporting. Updates retain their
  independent 200-ms network deadline. Local state, discovery, spawning, and
  scheduling add overhead; existing stdout/JSON and exit codes remain authoritative.
  Flush/deletion return pending status until a worker acknowledgement. Queues,
  retry suppression, offline/withdrawal rules, and generation-safe ACKs remain
  shared-client responsibilities.

## Context

The v2 CLI needs to distinguish usage of its own tools while keeping updates
available without usage consent. The earlier update-check protocol had no
stable installation or repository identity and could not answer those questions.
A separate opted-in reporting lifecycle supports those measurements without
making an ordinary update check a consent decision.

Accounting and advisory delivery cannot depend on a long-running command
returning. Automatic updates are useful when a person can see the notice;
unattended pipelines should not pay for unsolicited checks. An explicit
override retains that capability for deliberate automation.

## Consequences

A shared client avoids separate implementations of consent, persistence, and
update delivery in each CLI. Stable installation IDs and repository hashes
support active installation/project and command-distribution statistics, but
require explicit consent and withdrawal/deletion controls. Opt-in reports do
not measure people, all installations, or total adoption; resets, lost state,
late/dropped batches, shared profiles, and fabricated clients affect coverage.

The previous version-service protocol combined update checks with coarse
request analytics. Existing published binaries keep that protocol; migrated
v2 invocations use only app-tracking. Retiring the old service is a separate
decision. A shared token or self-reported binary hash cannot prove authentic
usage; additional challenges remain deferred.

Production telemetry activation belongs to app-tracking operations, including
provider/privacy settings, request limits, retention, and a verified deployed
revision. Consumer code and synthetic tests alone do not certify that service.
The [CLI reference](../docs/cli.md#advisory-update-checks),
[telemetry guide](../docs/telemetry.md), and
[shared contract](https://github.com/sebastian-software/app-tracking/blob/main/docs/telemetry-api.md)
own exact controls, wire values, and delivery evidence.

## Change history

- 2026-10-27: Run the invocation lifecycle before commands; make automatic updates
  interactive and local, with explicit CI/noninteractive opt-in.
- 2026-10-26: Move telemetry networking out of the command process after live
  registration attempts could not be acknowledged within the former 200-ms
  deadline. Adopt the shared bounded background worker; keep updates independent.
