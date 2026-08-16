#![allow(
    missing_docs,
    reason = "client errors and wire lifecycle structs are self-describing"
)]

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::decode::SemanticFactsDecodeError;
use super::model::{SemanticSnapshot, SemanticSnapshotRequest};

#[derive(Clone, Default)]
pub struct CancellationToken {
    state: Arc<CancellationState>,
}

#[derive(Default)]
struct CancellationState {
    cancelled: AtomicBool,
    mutex: Mutex<()>,
    changed: Condvar,
}

impl std::fmt::Debug for CancellationToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CancellationToken")
            .field("cancelled", &self.is_cancelled())
            .finish()
    }
}

impl CancellationToken {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.state.cancelled.store(true, Ordering::Release);
        self.state.changed.notify_all();
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn wait_until_cancelled_or_done(&self, done: &AtomicBool) {
        let mut guard = self
            .state
            .mutex
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while !self.is_cancelled() && !done.load(Ordering::Acquire) {
            guard = self
                .state
                .changed
                .wait(guard)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    }

    pub(crate) fn wake_waiters(&self) {
        self.state.changed.notify_all();
    }
}

#[derive(Debug, Error)]
pub enum SemanticTransportError {
    #[error("failed to spawn semantic-facts process {executable:?}: {source}")]
    Spawn {
        executable: String,
        #[source]
        source: std::io::Error,
    },
    #[error("semantic-facts transport {operation} failed: {source}")]
    Io {
        operation: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error("semantic-facts process exited (code {code:?}): {stderr}")]
    ProcessExited { code: Option<i32>, stderr: String },
    #[error("semantic-facts protocol error {code}: {message}")]
    Protocol { code: i64, message: String },
    #[error("semantic-facts request was cancelled")]
    Cancelled,
    #[error("semantic-facts transport is closed")]
    Closed,
    #[error("invalid semantic-facts protocol response: {0}")]
    InvalidResponse(String),
}

/// Injectable transport for the TS7 asynchronous JSON-RPC lifecycle.
pub trait SemanticSnapshotTransport {
    /// Sends one JSON-RPC request and returns its raw result value.
    fn request(
        &mut self,
        method: &str,
        params: serde_json::Value,
        cancellation: &CancellationToken,
    ) -> Result<serde_json::Value, SemanticTransportError>;

    /// Returns reproducibility metadata for the concrete transport.
    fn description(&self) -> String;

    /// Closes the transport and waits for owned resources to finish.
    fn close(&mut self) -> Result<(), SemanticTransportError>;
}

#[derive(Debug, Error)]
pub enum SemanticSnapshotClientError {
    #[error(transparent)]
    Transport(#[from] SemanticTransportError),
    #[error("could not decode {method} response: {source}")]
    Response {
        method: &'static str,
        #[source]
        source: serde_json::Error,
    },
    #[error("snapshot {snapshot} did not contain project {project:?}")]
    ProjectNotFound { snapshot: u64, project: String },
    #[error(transparent)]
    Snapshot(#[from] SemanticFactsDecodeError),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSnapshotMetadata {
    pub transport: String,
    pub server_current_directory: String,
    pub server_uses_case_sensitive_file_names: bool,
    pub snapshot_id: u64,
    pub project_id: String,
    pub schema_version: u32,
    pub typescript_version: String,
    pub typescript_revision: String,
    pub offset_encoding: String,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSnapshotRun {
    pub snapshot: SemanticSnapshot,
    pub metadata: SemanticSnapshotMetadata,
}

/// Owns one injected TS7 transport and follows initialize/update/query/release.
pub struct SemanticSnapshotClient<T> {
    transport: T,
    initialized: Option<InitializeResponse>,
}

impl<T: SemanticSnapshotTransport> SemanticSnapshotClient<T> {
    #[must_use]
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            initialized: None,
        }
    }

    /// Retrieves and validates a semantic snapshot from a pinned TS7 project snapshot.
    ///
    /// The snapshot handle is released even when decoding or validation fails.
    pub fn capture(
        &mut self,
        project_config: &str,
        request: &SemanticSnapshotRequest,
        cancellation: &CancellationToken,
    ) -> Result<SemanticSnapshotRun, SemanticSnapshotClientError> {
        let initialized = self.ensure_initialized(cancellation)?.clone();
        let update_value = self.transport.request(
            "updateSnapshot",
            serde_json::json!({ "openProjects": [project_config] }),
            cancellation,
        )?;
        let update: UpdateSnapshotResponse = decode_response("updateSnapshot", update_value)?;
        let project_id = match choose_project(&update, project_config) {
            Some(project) => project.id.clone(),
            None => {
                let error = SemanticSnapshotClientError::ProjectNotFound {
                    snapshot: update.snapshot,
                    project: project_config.to_owned(),
                };
                let _ = self.release_project(update.snapshot, project_config);
                return Err(error);
            }
        };

        let result = (|| {
            let params = SemanticSnapshotParams {
                snapshot: update.snapshot,
                project: &project_id,
                request,
            };
            let params = serde_json::to_value(params).map_err(|source| {
                SemanticSnapshotClientError::Response {
                    method: "getSemanticSnapshot request",
                    source,
                }
            })?;
            let value = self
                .transport
                .request("getSemanticSnapshot", params, cancellation)?;
            let snapshot: SemanticSnapshot = serde_json::from_value(value).map_err(|source| {
                SemanticSnapshotClientError::Response {
                    method: "getSemanticSnapshot",
                    source,
                }
            })?;
            snapshot
                .validate()
                .map_err(SemanticFactsDecodeError::from)?;
            Ok(snapshot)
        })();

        let cleanup = self.release_project(update.snapshot, project_config);
        let snapshot = match (result, cleanup) {
            (Ok(snapshot), Ok(())) => snapshot,
            (Err(error), _) => return Err(error),
            (Ok(_), Err(error)) => return Err(error),
        };

        let metadata = SemanticSnapshotMetadata {
            transport: self.transport.description(),
            server_current_directory: initialized.current_directory,
            server_uses_case_sensitive_file_names: initialized.use_case_sensitive_file_names,
            snapshot_id: update.snapshot,
            project_id,
            schema_version: snapshot.header.schema_version,
            typescript_version: snapshot.header.typescript_version.clone(),
            typescript_revision: snapshot.header.typescript_revision.clone(),
            offset_encoding: snapshot.header.offset_encoding.clone(),
            capabilities: snapshot.header.capabilities.clone(),
        };
        Ok(SemanticSnapshotRun { snapshot, metadata })
    }

    /// Explicitly closes the underlying process or injected transport.
    pub fn close(&mut self) -> Result<(), SemanticSnapshotClientError> {
        self.transport.close()?;
        Ok(())
    }

    /// Returns the owned transport after the caller has finished the client lifecycle.
    #[must_use]
    pub fn into_transport(self) -> T {
        self.transport
    }

    fn ensure_initialized(
        &mut self,
        cancellation: &CancellationToken,
    ) -> Result<&InitializeResponse, SemanticSnapshotClientError> {
        if self.initialized.is_none() {
            let value =
                self.transport
                    .request("initialize", serde_json::Value::Null, cancellation)?;
            self.initialized = Some(decode_response("initialize", value)?);
        }
        Ok(self
            .initialized
            .as_ref()
            .expect("initialized response was stored above"))
    }

    fn release_project(
        &mut self,
        snapshot: u64,
        project_config: &str,
    ) -> Result<(), SemanticSnapshotClientError> {
        let cleanup_token = CancellationToken::new();
        self.transport.request(
            "release",
            serde_json::json!({ "snapshot": snapshot }),
            &cleanup_token,
        )?;
        let closed = self.transport.request(
            "updateSnapshot",
            serde_json::json!({ "closeProjects": [project_config] }),
            &cleanup_token,
        )?;
        let closed: UpdateSnapshotResponse = decode_response("updateSnapshot cleanup", closed)?;
        self.transport.request(
            "release",
            serde_json::json!({ "snapshot": closed.snapshot }),
            &cleanup_token,
        )?;
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitializeResponse {
    use_case_sensitive_file_names: bool,
    current_directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSnapshotResponse {
    snapshot: u64,
    projects: Vec<ProjectResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectResponse {
    id: String,
    config_file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticSnapshotParams<'a> {
    snapshot: u64,
    project: &'a str,
    #[serde(flatten)]
    request: &'a SemanticSnapshotRequest,
}

fn decode_response<T: for<'de> Deserialize<'de>>(
    method: &'static str,
    value: serde_json::Value,
) -> Result<T, SemanticSnapshotClientError> {
    serde_json::from_value(value)
        .map_err(|source| SemanticSnapshotClientError::Response { method, source })
}

fn choose_project<'a>(
    update: &'a UpdateSnapshotResponse,
    requested: &str,
) -> Option<&'a ProjectResponse> {
    let requested = normalize_path(requested);
    update.projects.iter().find(|project| {
        let config = normalize_path(&project.config_file_name);
        config == requested || config.ends_with(&format!("/{requested}"))
    })
}

fn normalize_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    normalized
        .strip_prefix("./")
        .unwrap_or(&normalized)
        .to_owned()
}
