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
    /// Version of the native `pmds` host.
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
    /// The absolute catalog path for this locale, storage extension included.
    pub path: String,
}

/// Diagnostic severities rendered consistently by the native CLI host.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Informational note.
    Info,
    /// Non-fatal problem worth surfacing.
    Warning,
    /// Failure; drives the default exit code to 1.
    Error,
}

impl Severity {
    /// The lowercase protocol spelling for this severity.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

/// A newline-delimited event a binary plugin writes to stdout.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum Event {
    /// Describes the plugin namespace and its commands.
    Manifest {
        /// Manifest payload. Flattened to preserve the protocol shape.
        #[serde(flatten)]
        manifest: PluginManifest,
    },
    /// Surfaces a diagnostic to the host.
    Diagnostic {
        /// Diagnostic payload. Flattened to preserve the protocol shape.
        #[serde(flatten)]
        diagnostic: PluginDiagnostic,
    },
    /// Streams human-readable output through the host.
    Output {
        /// Output line text.
        text: String,
    },
    /// Completes a command invocation.
    Result {
        /// Result payload. Flattened to preserve the protocol shape.
        #[serde(flatten)]
        result: PluginResult,
    },
}

/// A plugin manifest emitted during protocol negotiation.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    /// Lowercase kebab-case plugin namespace.
    pub name: String,
    /// Binary plugin protocol major implemented by the plugin.
    pub protocol_version: u64,
    /// Commands exposed by the plugin, keyed by command name.
    #[serde(default)]
    pub commands: BTreeMap<String, ManifestCommand>,
}

/// A command exposed by a plugin manifest.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ManifestCommand {
    /// Optional human-readable command description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// A structured diagnostic emitted by a binary plugin.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginDiagnostic {
    /// Severity rendered by the native host.
    pub severity: Severity,
    /// Human-readable diagnostic text.
    pub message: String,
    /// Stable machine-readable diagnostic code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Optional structured diagnostic metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl PluginDiagnostic {
    /// Formats this diagnostic as the native host renders it for terminals.
    pub fn display(&self) -> String {
        let code = self
            .code
            .as_deref()
            .map(|code| format!(" {code}"))
            .unwrap_or_default();
        format!("[{}{}] {}", self.severity.as_str(), code, self.message)
    }
}

/// A command result emitted by a binary plugin.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginResult {
    /// Optional human-readable result text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Optional structured result data. An explicit JSON null is preserved.
    #[serde(
        default,
        deserialize_with = "deserialize_optional_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub data: Option<Value>,
    /// Optional explicit process exit code. The host accepts omission and
    /// derives a default from emitted diagnostics.
    #[serde(rename = "exitCode", default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u8>,
}

fn deserialize_optional_value<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}
