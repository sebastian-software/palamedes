# TS7 semantic-facts bridge

Implementation snapshot: 2026-08-16.

Palamedes can decode the TypeScript Semantic Kernel schema and retrieve it from
the TS7 asynchronous process API. This remains a measured vertical-slice
integration, not a promise that TypeScript semantics are required by ordinary
Palamedes extraction.

```rust
use palamedes::{
    CancellationToken, ProcessSemanticSnapshotTransport,
    SemanticSnapshotClient, SemanticSnapshotRequest,
};

let transport = ProcessSemanticSnapshotTransport::spawn(
    std::env::var("TSGO_EXE").expect("set TSGO_EXE for the spike"),
    std::env::current_dir().expect("current directory"),
)?;
let mut client = SemanticSnapshotClient::new(transport);
let run = client.capture(
    "tsconfig.json",
    &SemanticSnapshotRequest::file_wide(vec!["src/example.ts".into()]),
    &CancellationToken::new(),
)?;

println!("{} facts", run.snapshot.facts.len());
client.close()?;
# Ok::<(), Box<dyn std::error::Error>>(())
```

The client records the executable description, server working directory,
snapshot and project handles, TypeScript version and revision, schema version,
offset encoding, and negotiated capabilities. Its error model distinguishes:

- executable startup and process exit, including captured stderr;
- framed JSON-RPC IO and remote protocol errors;
- cancellation (`-32800`);
- malformed lifecycle responses;
- incompatible or internally invalid semantic snapshots.

Tests normally inject `SemanticSnapshotTransport`, so they do not require TS7.
The canonical fixtures below are copied byte-for-byte from the Semantic Kernel
repository and carry their upstream provenance next to the files.

The optional real-process contract test is enabled explicitly:

```sh
PALAMEDES_TSGO_EXE=/path/to/tsgo cargo test -p palamedes --test semantic_facts real_ts7_process_snapshot_when_configured -- --nocapture
```

It creates an isolated TypeScript project, exercises the complete process and
project lifecycle, validates the returned graph, and closes the child. CI still
uses the injected transport because the TS7 executable belongs to the sibling
Semantic Kernel repository rather than Palamedes' dependency graph.

The durable ownership and compatibility rules are recorded in
[ADR-026](../../adr/026-typescript-semantics-over-a-versioned-process-boundary.md).
