use std::collections::VecDeque;

use palamedes::{
    CancellationToken, ProcessSemanticSnapshotTransport, SemanticFactsDecodeError,
    SemanticFactsValidationError, SemanticSnapshot, SemanticSnapshotClient,
    SemanticSnapshotClientError, SemanticSnapshotRequest, SemanticSnapshotTransport,
    SemanticTransportError,
};
use serde_json::{json, Value};

const SHARING_CYCLE: &str = include_str!("fixtures/semantic-facts/v0/sharing-cycle.jsonl");
const OCCURRENCE_VIEWS: &str = include_str!("fixtures/semantic-facts/v0/occurrence-views.jsonl");
const ENTITY_STATES: &str = include_str!("fixtures/semantic-facts/v0/explicit-entity-states.jsonl");
const TRUNCATION_RECOVERY: &str =
    include_str!("fixtures/semantic-facts/v0/budget-truncation-recovery.jsonl");

#[test]
fn canonical_v0_fixtures_decode_and_validate() {
    for source in [
        SHARING_CYCLE,
        OCCURRENCE_VIEWS,
        ENTITY_STATES,
        TRUNCATION_RECOVERY,
    ] {
        SemanticSnapshot::decode_json_lines(source).unwrap();
    }
}

#[test]
fn sharing_and_cycles_keep_response_local_identity() {
    let snapshot = SemanticSnapshot::decode_json_lines(SHARING_CYCLE).unwrap();
    assert_eq!(
        snapshot.types[2].constraint.as_ref().unwrap().as_str(),
        "type:1"
    );
    assert_eq!(
        snapshot.types[2].default.as_ref().unwrap().as_str(),
        "type:1"
    );
    assert_eq!(snapshot.symbols[0].members[0].as_str(), "symbol:1");
    assert_eq!(snapshot.signatures[0].return_type.as_str(), "type:1");
}

#[test]
fn compatible_unknown_fields_and_issue_codes_are_retained_or_ignored() {
    let source = OCCURRENCE_VIEWS
        .replace(
            "\"record\":\"type\"",
            "\"record\":\"type\",\"futureField\":true",
        )
        .replace(
            "\"state\":\"complete\"",
            "\"issues\":[],\"state\":\"complete\"",
        );
    SemanticSnapshot::decode_json_lines(&source).unwrap();
}

#[test]
fn unknown_variants_fail_explicitly() {
    let source = OCCURRENCE_VIEWS.replace("\"typeKind\":\"string\"", "\"typeKind\":\"future\"");
    assert!(matches!(
        SemanticSnapshot::decode_json_lines(&source),
        Err(SemanticFactsDecodeError::JsonLine { line: 3, .. })
    ));
}

#[test]
fn duplicate_ids_and_invalid_references_are_actionable() {
    let duplicate = SHARING_CYCLE.replace("\"id\":\"type:3\"", "\"id\":\"type:2\"");
    assert!(matches!(
        SemanticSnapshot::decode_json_lines(&duplicate),
        Err(SemanticFactsDecodeError::Validation(
            SemanticFactsValidationError::DuplicateId { .. }
        ))
    ));

    let missing =
        OCCURRENCE_VIEWS.replace("\"actualType\":\"type:1\"", "\"actualType\":\"type:99\"");
    assert!(matches!(
        SemanticSnapshot::decode_json_lines(&missing),
        Err(SemanticFactsDecodeError::Validation(
            SemanticFactsValidationError::MissingReference { .. }
        ))
    ));
}

#[test]
fn async_lifecycle_uses_an_injected_transport_and_releases_snapshot() {
    let snapshot = SemanticSnapshot::decode_json_lines(OCCURRENCE_VIEWS).unwrap();
    let transport = FixtureTransport::new(vec![
        json!({
            "useCaseSensitiveFileNames": true,
            "currentDirectory": "/fixture"
        }),
        json!({
            "snapshot": 41,
            "projects": [{
                "id": "/fixture/tsconfig.json",
                "configFileName": "/fixture/tsconfig.json"
            }]
        }),
        serde_json::to_value(snapshot).unwrap(),
        Value::Null,
        json!({ "snapshot": 42, "projects": [] }),
        Value::Null,
    ]);
    let mut client = SemanticSnapshotClient::new(transport);
    let run = client
        .capture(
            "tsconfig.json",
            &SemanticSnapshotRequest::file_wide(vec!["src/example.ts".to_owned()]),
            &CancellationToken::new(),
        )
        .unwrap();

    assert_eq!(run.metadata.snapshot_id, 41);
    assert_eq!(run.metadata.typescript_version, "7.0.0-dev");
    let transport = client.into_transport();
    assert_eq!(
        transport.methods,
        [
            "initialize",
            "updateSnapshot",
            "getSemanticSnapshot",
            "release",
            "updateSnapshot",
            "release"
        ]
    );
    assert_eq!(transport.params[2]["snapshot"], 41);
    assert_eq!(transport.params[2]["project"], "/fixture/tsconfig.json");
    assert_eq!(transport.params[4]["closeProjects"][0], "tsconfig.json");
}

#[test]
fn cancellation_is_distinct_from_protocol_and_process_failure() {
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    let mut transport = FixtureTransport::new(Vec::new());
    let error = transport
        .request("initialize", Value::Null, &cancellation)
        .unwrap_err();
    assert!(matches!(error, SemanticTransportError::Cancelled));
    assert!(matches!(
        SemanticTransportError::Protocol {
            code: -32603,
            message: "boom".to_owned()
        },
        SemanticTransportError::Protocol { .. }
    ));
    assert!(matches!(
        SemanticTransportError::ProcessExited {
            code: Some(1),
            stderr: "boom".to_owned()
        },
        SemanticTransportError::ProcessExited { .. }
    ));
}

#[test]
fn invalid_snapshot_is_rejected_after_snapshot_and_project_cleanup() {
    let snapshot = SemanticSnapshot::decode_json_lines(OCCURRENCE_VIEWS).unwrap();
    let mut snapshot = serde_json::to_value(snapshot).unwrap();
    snapshot["facts"][0]["actualType"] = json!("type:99");
    let transport = FixtureTransport::new(vec![
        json!({
            "useCaseSensitiveFileNames": true,
            "currentDirectory": "/fixture"
        }),
        json!({
            "snapshot": 41,
            "projects": [{
                "id": "/fixture/tsconfig.json",
                "configFileName": "/fixture/tsconfig.json"
            }]
        }),
        snapshot,
        Value::Null,
        json!({ "snapshot": 42, "projects": [] }),
        Value::Null,
    ]);
    let mut client = SemanticSnapshotClient::new(transport);
    let error = client
        .capture(
            "tsconfig.json",
            &SemanticSnapshotRequest::file_wide(vec!["src/example.ts".to_owned()]),
            &CancellationToken::new(),
        )
        .unwrap_err();
    assert!(matches!(
        error,
        SemanticSnapshotClientError::Snapshot(SemanticFactsDecodeError::Validation(
            SemanticFactsValidationError::MissingReference { .. }
        ))
    ));
    assert_eq!(
        client.into_transport().methods,
        [
            "initialize",
            "updateSnapshot",
            "getSemanticSnapshot",
            "release",
            "updateSnapshot",
            "release"
        ]
    );
}

#[test]
fn missing_process_executable_is_a_spawn_failure() {
    let missing =
        std::env::temp_dir().join(format!("palamedes-missing-tsgo-{}", std::process::id()));
    let error = ProcessSemanticSnapshotTransport::spawn(&missing, ".")
        .err()
        .expect("missing executable must fail to spawn");
    assert!(matches!(error, SemanticTransportError::Spawn { .. }));
}

#[test]
fn real_ts7_process_snapshot_when_configured() {
    let Ok(executable) = std::env::var("PALAMEDES_TSGO_EXE") else {
        eprintln!("PALAMEDES_TSGO_EXE is unset; skipping the optional TS7 process test");
        return;
    };
    let fixture = tempfile::tempdir().unwrap();
    std::fs::create_dir(fixture.path().join("src")).unwrap();
    std::fs::write(
        fixture.path().join("tsconfig.json"),
        r#"{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}"#,
    )
    .unwrap();
    std::fs::write(
        fixture.path().join("src/example.ts"),
        "export const greeting = { text: 'hello' } as const;\n",
    )
    .unwrap();

    let transport = ProcessSemanticSnapshotTransport::spawn(executable, fixture.path()).unwrap();
    let mut client = SemanticSnapshotClient::new(transport);
    let run = client
        .capture(
            "tsconfig.json",
            &SemanticSnapshotRequest::file_wide(vec!["src/example.ts".to_owned()]),
            &CancellationToken::new(),
        )
        .unwrap();
    assert!(!run.snapshot.facts.is_empty());
    assert_eq!(run.metadata.schema_version, 1);
    assert_eq!(run.metadata.offset_encoding, "utf8-bytes");
    client.close().unwrap();
}

struct FixtureTransport {
    responses: VecDeque<Value>,
    methods: Vec<String>,
    params: Vec<Value>,
    closed: bool,
}

impl FixtureTransport {
    fn new(responses: Vec<Value>) -> Self {
        Self {
            responses: responses.into(),
            methods: Vec::new(),
            params: Vec::new(),
            closed: false,
        }
    }
}

impl SemanticSnapshotTransport for FixtureTransport {
    fn request(
        &mut self,
        method: &str,
        params: Value,
        cancellation: &CancellationToken,
    ) -> Result<Value, SemanticTransportError> {
        if cancellation.is_cancelled() {
            return Err(SemanticTransportError::Cancelled);
        }
        self.methods.push(method.to_owned());
        self.params.push(params);
        self.responses.pop_front().ok_or_else(|| {
            SemanticTransportError::InvalidResponse("fixture response exhausted".to_owned())
        })
    }

    fn description(&self) -> String {
        "fixture://semantic-facts".to_owned()
    }

    fn close(&mut self) -> Result<(), SemanticTransportError> {
        self.closed = true;
        Ok(())
    }
}
