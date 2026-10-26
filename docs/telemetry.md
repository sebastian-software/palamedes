# Optional CLI usage reporting

Palamedes v2 includes the shared Rust app-tracking client for optional native
CLI usage reporting. It is off until you opt in. Previous update-check analytics
are not consent. The npm launcher, framework/build plugins, Rust/Node APIs, and
application runtimes do not report automatically.

The service's production activation is tracked in
[app-tracking #11](https://github.com/sebastian-software/app-tracking/issues/11).
The consumer integration must pass its deployed-service checks before release;
merging code alone does not establish production readiness.

## Choose and inspect

```sh
pmds telemetry enable                         # Read the complete notice only
pmds telemetry enable --accept telemetry-v1   # Affirm informed consent
pmds telemetry status                         # Local JSON status, no request
pmds telemetry preview                        # Local payload preview, no request
pmds telemetry disable                        # Withdraw and discard unsent data
pmds telemetry decline                        # Record a refusal
pmds telemetry delete                         # Stop and request remote deletion
pmds telemetry flush                          # Try one pending request
```

There is no forced prompt, preselected consent, or installation hook. The full
notice is available in English before consent through `telemetry enable`.
Status and preview omit credentials. They can prune locally expired or vetoed
data but do not send anything or create an initial identity.

Disabling stops collection/upload and drops unsent reports. Deletion also
removes retained active contributions after an authenticated acknowledgement.
Offline deletion remains visibly pending. Later ordinary invocations or another
`delete` attempt can retry online. A busy control reports failure rather than
claiming that withdrawal or deletion succeeded. `reset` deletes the old identity
before a separate new `enable` decision. If local authority is lost or corrupt,
`forget --acknowledge-unverified-deletion` abandons it without confirming remote
deletion; retaining the credential is necessary for authenticated deletion.

## What counts

One successfully parsed command entering native execution counts once,
including when that command later fails. npm-to-native execution does not count
twice. The fixed categories are:

| CLI operation                       | Category         |
| ----------------------------------- | ---------------- |
| `extract`                           | `extract`        |
| `lint`                              | `lint`           |
| `audit`                             | `audit`          |
| `report`                            | `report`         |
| `catalog merge`                     | `catalogmerge`   |
| `catalog convert`                   | `catalogconvert` |
| `catalog compile`                   | `catalogcompile` |
| Explicit external plugin invocation | `plugin`         |
| Future reviewed fallback            | `other`          |

Help/version, telemetry controls, automatic `catalog merge-driver` execution,
and individual watch rebuilds do not count. A watch session is one CLI
invocation, counted when it returns; an abruptly terminated process can lose
that final count. Plugin names and arguments are never categories.

Reports contain UTC day, exact tool version, category, count, consent revision,
local/CI context, and a tool/profile-scoped installation identity. Registration
also declares consent time. UUID installation/batch IDs contain creation time.
The client normally uploads accumulated counts daily while the tool runs.

After effective collection consent, the CLI reads the associated project's raw
local Git origin, or package.json repository metadata only if origin is
confirmed absent. An explicit `--config` selects that config's directory;
otherwise extraction/lint/audit/report discovery starts at the invocation
directory. File-oriented catalog operations without `--config` and external
plugins use unknown project context rather than guessing from their arguments.
Missing, ambiguous,
unsupported, or failed lookup yields unknown project context. A bounded local
Git-config read runs with no includes, hooks, URL rewrites, or network access.

The shared normalization produces SHA-256 of the normalized repository URL.
Equivalent clones/developers share one project hash, including across our
tools; forks remain distinct. Guessing a URL lets someone compute its hash, so
this is pseudonymous data. The client never persists the raw repository URL.
Arguments, source/catalog content, paths, plugin names, usernames, and machine
names are not report fields.

## Settings and state

| Setting                              | Behavior                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DO_NOT_TRACK=1`                     | Veto collection/upload, discard unsent usage, and preserve the existing update opt-out. Explicit deletion remains available.                                    |
| `PALAMEDES_TELEMETRY=off`            | Disable collection/upload independently of updates. Any supplied value other than `on` vetoes collection.                                                       |
| `APP_TRACKING_TELEMETRY=off`         | Shared collection/upload veto; invalid values also veto.                                                                                                        |
| `APP_TRACKING_CONSENT=telemetry-v1`  | Informed process/deployment consent after reviewing the same notice; it does not become persistent permission. Removing it stops environment-granted reporting. |
| `PALAMEDES_UPDATE_CHECK=0`           | Disable updates; it does not grant or withdraw telemetry consent.                                                                                               |
| `--offline` or `PALAMEDES_OFFLINE=1` | No update or telemetry networking, including deletion. Consented local counts can accumulate within bounds.                                                     |
| `APP_TRACKING_STATE_DIR`             | Absolute private state root; mandatory and isolated per job/run in CI. Never put it in a repository or shared CI cache.                                         |

A stored refusal/withdrawal overrides an environment grant. Neither non-TTY nor
JSON output establishes consent or agent use. CI additionally requires
`APP_TRACKING_CI=telemetry-v1`; it cannot inherit local consent or identity.
CI state uses a separate scope under the supplied directory. Use a dedicated
directory unique to the run/job and preserve it only for that run's commands.

Without an override, state lives under `$XDG_STATE_HOME/palamedes/app-tracking`
(or `$HOME/.local/state/palamedes/app-tracking`) on Linux,
`$HOME/Library/Application Support/palamedes/app-tracking` on macOS, and
`%LOCALAPPDATA%/palamedes/app-tracking` on Windows. Use a local filesystem with
working OS locks. Unix-created state is private (0700 directories, 0600 files);
Windows roots must inherit private user-profile ACLs. Do not copy state between
users or publish it. Source builds without the validated release endpoint stay
offline, including when consent is given.

## Delivery, retention, and interpretation

The shared client bounds state to 4 MiB, 4,096 open dimensions, 64 batches, and
seven eligible UTC dates of unsent usage. Overflow/expiry can drop old data;
status exposes local dropped counts. Each invocation attempts at most one
telemetry request, with a 200 ms network deadline. Independent update waiting,
discovery, filesystem work, and scheduling are additional. Reports retry the
same immutable batch after unknown outcomes; accepted duplicates do not count
again. Terminal conflicts pause rather than silently replacing an identity.

Active usage is retained for at most 90 days, with physical cleanup within
another 24 hours. The shared contract describes receipts, minimal revocation
records, ordinary database backups, and restore behavior. Lost/offline batches,
stopped tools, reset/copied state, opt-in bias, and fabricated clients limit
coverage. Counts describe reported invocations, installations, and repositories;
they do not measure people, all adoption, or every tool execution. Distinct
project/installation counts must be deduplicated over the requested period.

Sebastian Software GmbH operates the service; privacy contact:
info@sebastian-software.de. See the
[common notice](https://github.com/sebastian-software/app-tracking/blob/main/docs/telemetry-consent.md),
[wire contract](https://github.com/sebastian-software/app-tracking/blob/main/docs/telemetry-api.md),
and [retention policy](https://github.com/sebastian-software/app-tracking/blob/main/docs/telemetry-retention.md).
Bunny hosts the API and processes transport metadata; PlanetScale stores
reports. Published provider information is available from
[Bunny](https://bunny.net/gdpr/), its
[subprocessor list](https://bunny.net/gdpr/sub-processors/), and the
[PlanetScale Trust Center](https://trust.planetscale.com/). These links do not
establish EU-only processing or replace verification of the deployed settings.
Provider-internal security/transport records follow the applicable provider
agreement and published policies. The service does not independently verify a
universal maximum for all such records; the current processor disclosure
distinguishes verified product limits from unknown internal periods. This does
not change the 90-day reporting retention described above.
