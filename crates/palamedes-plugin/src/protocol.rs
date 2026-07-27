//! Wire types for the `pmds` binary plugin protocol (version 1).
//!
//! The host writes one JSON [`Request`] to the plugin's stdin and reads
//! newline-delimited JSON events from its stdout. See
//! `docs/api/cli-binary-plugin.md` and ADR 018 for the protocol contract.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The binary plugin protocol major this SDK speaks.
pub const PROTOCOL_VERSION: u64 = 1;

/// A request the `pmds` host writes to the plugin's stdin.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// Protocol major the host speaks; must match [`PROTOCOL_VERSION`].
    #[serde(rename = "palamedesBinaryPluginProtocol")]
    pub protocol_version: u64,
    /// Version of the `@palamedes/cli` host package.
    #[serde(default)]
    pub host_version: String,
    /// Whether the host asks for the manifest or a command run.
    pub kind: RequestKind,
    /// The invoked command name; empty for `describe`.
    #[serde(default)]
    pub command: String,
    /// Positional command arguments after host option parsing.
    #[serde(default)]
    pub args: Vec<String>,
    /// The options value from the plugin's configuration tuple.
    #[serde(default)]
    pub options: Value,
    /// True when the invocation runs with `--json`.
    #[serde(default)]
    pub json: bool,
    /// False for JSON output, CI, and non-TTY execution.
    #[serde(default)]
    pub interactive: bool,
    /// The resolved Palamedes configuration.
    #[serde(default)]
    pub config: Value,
    /// Semantic catalog enumeration with absolute per-locale paths.
    #[serde(default)]
    pub catalogs: Vec<Catalog>,
}

/// The two request kinds a plugin must answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestKind {
    /// Answer with exactly one manifest event.
    Describe,
    /// Execute the named command and answer with events plus one result.
    Run,
}

/// One configured catalog definition.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// The configured catalog path pattern containing `{locale}`.
    pub path: String,
    /// Catalog storage format, `po` or `fcl`.
    #[serde(default = "default_format")]
    pub format: String,
    /// Configured include patterns.
    #[serde(default)]
    pub include: Vec<String>,
    /// Configured exclude patterns.
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Absolute catalog paths per locale.
    #[serde(default)]
    pub locales: Vec<LocaleCatalog>,
}

fn default_format() -> String {
    "po".to_owned()
}

/// An absolute catalog path for one locale.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocaleCatalog {
    /// The locale identifier, e.g. `de`.
    pub locale: String,
    /// The absolute catalog path for this locale.
    pub path: String,
}

/// Diagnostic severities shared with the ESM plugin API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Informational note.
    Info,
    /// Non-fatal problem worth surfacing.
    Warning,
    /// Failure; drives the default exit code to 1.
    Error,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub(crate) enum Event {
    Manifest {
        name: String,
        #[serde(rename = "protocolVersion")]
        protocol_version: u64,
        commands: BTreeMap<String, ManifestCommand>,
    },
    Diagnostic {
        severity: Severity,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<Value>,
    },
    Output {
        text: String,
    },
    Result {
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
        #[serde(rename = "exitCode")]
        exit_code: u8,
    },
}

#[derive(Debug, Serialize)]
pub(crate) struct ManifestCommand {
    pub(crate) description: String,
}
