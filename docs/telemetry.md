# Optional CLI usage reporting

Palamedes v2 includes the shared Rust app-tracking client for optional native
CLI usage reporting. It is off until you opt in. Previous update-check analytics
are not consent. The npm launcher, framework/build plugins, Rust/Node APIs, and
application runtimes do not report automatically.

## Choose and inspect

```sh
pmds telemetry enable                         # Read the complete notice only
pmds telemetry enable --accept telemetry-v1   # Affirm informed consent
pmds telemetry status                         # Local JSON status, no request
pmds telemetry preview                        # Local payload preview, no request
pmds telemetry disable                        # Withdraw and discard unsent data
pmds telemetry decline                        # Record a refusal
pmds telemetry delete                         # Stop and request remote deletion
pmds telemetry flush                          # Schedule one pending operation
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
invocation, persisted before command execution. Rebuilds and Ctrl-C do not add
another count. A process killed before that local write, or a state/queue
failure, can still lose a count. Plugin names and arguments are never categories.

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
| `PALAMEDES_UPDATE_CHECK=1`           | Explicitly enable updates in CI or noninteractive use, subject to offline and do-not-track vetoes; it never grants telemetry consent.                           |
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
background request in a short-lived copy of the same binary. The command does
not wait for that request or worker exit. A worker can continue after the command
finishes; its network deadline is five seconds. It never enters a normal command,
discovers a project, or counts itself. Independent update waiting remains bounded
to 200 ms; discovery, local filesystem work, process startup, and scheduling are
additional. Reports retry the
same immutable batch after unknown outcomes; accepted duplicates do not count
again. Terminal conflicts pause rather than silently replacing an identity.

Active usage is retained for at most 90 days, with physical cleanup within
another 24 hours. The shared contract describes receipts, minimal revocation
records, ordinary database backups, and restore behavior. Lost/offline batches,
stopped tools, reset/copied state, opt-in bias, and fabricated clients limit
coverage. Counts describe reported invocations, installations, and repositories;
they do not measure people, all adoption, or every tool execution. Distinct
project/installation counts must be deduplicated over the requested period.

The opt-in live CLI proof uses a fresh synthetic profile, verifies exactly one
consented native invocation, waits for the shared client's upload acknowledgement,
checks withdrawal, and requests authenticated deletion in its cleanup path:

```sh
PALAMEDES_LIVE_TELEMETRY_PROOF=1 node scripts/verify-cli-telemetry-live.mjs /path/to/pmds /path/to/ui-catalogs
```

It never uses the current user's profile or repository. If deletion cannot be
confirmed, it retains the private test state and prints its location for cleanup
instead of discarding the only deletion credentials. This is a deliberate
service smoke test, separate from normal offline tests and CI.

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

`flush`, `delete`, and `reset` schedule a background attempt and return the
current local status; they do not wait for remote acknowledgement. Inspect
`telemetry status` to observe completion. Existing retry suppression still
applies. A killed worker or CI/container teardown can prevent final delivery,
so preserve the isolated state until acknowledgement when it matters. There
is no permanent daemon, postinstall hook, or retry loop. The worker reloads
private state and policy before sending and uses the same consent, offline,
network-lock, and generation rules as the shared client.

## Additional reporting choices

The unified stream requires a fresh grant because it includes system context.
Existing `telemetry-v1` grants continue to cover only legacy invocation reports.
No upgrade, environment grant, or shared profile file grants a new purpose.

```sh
pmds telemetry usage enable                       # Read the expanded notice
pmds telemetry usage enable --accept palamedes-events-v1
pmds telemetry usage status                       # All unified choices, local only
pmds telemetry usage preview                      # Exact queued payloads, local only
pmds telemetry usage disable
pmds telemetry usage delete
pmds telemetry usage sync                         # Retry pending settings/delivery

pmds telemetry history enable                     # Read the separate notice
pmds telemetry history enable --accept monthly-history-v1
pmds telemetry history disable
pmds telemetry history status
pmds telemetry history sync

pmds telemetry publication enable                 # Read the public-use notice
pmds telemetry publication enable --accept public-usage-v1
pmds telemetry publication disable
pmds telemetry publication status
pmds telemetry publication sync

pmds telemetry profile enable                     # Read the separate notice
pmds telemetry profile enable --accept profile-linking-v1
pmds telemetry profile disable                    # Unlink only Palamedes
pmds telemetry profile reset --all-tools           # Remove all shared links
pmds telemetry profile status
pmds telemetry profile sync
```

Each notice-only command leaves state unchanged. `--accept` requires its exact
revision; there is no preselected choice or prompt during an ordinary command.
The expanded notice describes coarse OS/version, executable architecture, CPU
family, and Linux distribution/kernel context. It links the official
[English](https://sebastian-software.com/privacy#tool-usage-reports) and
[German](https://sebastian-software.de/privacy#tool-usage-reports) notice.

Enabling the unified stream stops legacy collection and discards unsent legacy
reports. It preserves old credentials for `telemetry status`, `preview`, `delete`,
`reset`, and `forget`; no old grant or queued usage is copied to the new stream.
Each native invocation uses one stream, including npm-to-native execution.
Explicitly enabling legacy reporting again stops unified collection. Top-level
`telemetry disable`, `decline`, `delete`, and `reset` also stop the unified stream;
status includes its permissions and pending changes under `unified`.

History retains screened monthly summaries for 24 months after month end while
detailed reports still expire after 90 days. Publication requires a third choice
in addition to history and uses only separately permitted contributions. Anyone
can access and copy its rounded, screened monthly totals; withdrawal cannot recall
copies held by others. Refusing publication preserves private history. Withdrawing
history also queues publication withdrawal and never silently re-enables it.

Profile linking permits future local-use overlap analysis, independently of
history and publication. It is excluded from CI. The private shared root is
`%LOCALAPPDATA%/sebastian-software/app-tracking` on Windows,
`~/Library/Application Support/sebastian-software/app-tracking` on macOS, or
`$XDG_STATE_HOME/sebastian-software/app-tracking` (falling back to
`~/.local/state/sebastian-software/app-tracking`) on Linux. It is separate from
per-tool and project state. Windows uses the private user's application-data ACL.
No machine ID or hardware fingerprint reconstructs a lost profile. A copied file
represents the same profile, not a verified person or physical machine.

Unlink removes only Palamedes' link. Shared reset removes all links, and neither
operation deletes independently retained reports; use each tool's deletion control
for those. Dalo and Ferriki consumer integration remains deferred.

Settings synchronization is explicit and bounded. Offline changes and failed
acknowledgements stay visibly pending. Ordinary reporting must first register the
identity with an accepted real event batch: no fake invocation is generated to
register it. A newly enabled additional choice may remain pending until you use
the tool, run `telemetry usage sync`, and retry the relevant scope's `sync`.
Eligibility starts from the UTC date after acknowledgement, never retroactively.
These controls do not grant ordinary reporting in CI; use an explicit unified grant
in isolated CI state with its separate CI revision. Update settings remain independent.
