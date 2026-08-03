//! Rust SDK for authoring `pmds` binary plugins.
//!
//! Binary plugins are standalone executables the Palamedes CLI spawns and
//! drives over a versioned newline-delimited JSON protocol on stdio (ADR 018).
//! This crate wraps that protocol so a plugin `main` reads like `definePlugin`
//! does in the JavaScript API: register namespaced commands, receive the
//! resolved project context, emit diagnostics and output, and return a result.
//!
//! ```no_run
//! use palamedes_plugin::{CommandResult, Plugin};
//! use serde_json::json;
//!
//! fn main() -> std::process::ExitCode {
//!     Plugin::new("acme")
//!         .command("inspect", "Inspect configured catalogs.", |context| {
//!             context.info(
//!                 "ACME_INSPECTED",
//!                 format!("Inspected {} catalog definitions.", context.catalogs().len()),
//!             );
//!             CommandResult::default()
//!                 .with_text("done")
//!                 .with_data(json!({ "args": context.args() }))
//!         })
//!         .run()
//! }
//! ```
//!
//! Free-form progress belongs on stderr, which the host passes through to the
//! terminal; stdout is reserved for protocol events and is fully managed by
//! this crate. A panic inside a handler ends the process without a result
//! event, in which case the host falls back to the process exit code and
//! reports a protocol diagnostic.

mod protocol;

use std::collections::BTreeMap;
use std::env;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use serde_json::Value;

pub use protocol::{Catalog, LocaleCatalog, Request, RequestKind, Severity, PROTOCOL_VERSION};

use protocol::{Event, ManifestCommand};

/// Environment variable carrying the absolute path of the native `pmds`
/// executable, set by the host for every plugin invocation.
pub const NATIVE_EXECUTABLE_ENV: &str = "PALAMEDES_NATIVE";

type Handler = Box<dyn Fn(&mut CommandContext) -> CommandResult>;

struct Command {
    name: String,
    description: String,
    handler: Handler,
}

/// A binary plugin: a namespace plus its explicit commands.
pub struct Plugin {
    name: String,
    commands: Vec<Command>,
}

impl Plugin {
    /// Creates a plugin with the given lowercase kebab-case namespace.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            commands: Vec::new(),
        }
    }

    /// Registers a namespaced command with a description and handler.
    ///
    /// # Panics
    ///
    /// Panics when `name` is already registered — the manifest and dispatch
    /// must never disagree about which handler a command name executes.
    pub fn command(
        mut self,
        name: impl Into<String>,
        description: impl Into<String>,
        handler: impl Fn(&mut CommandContext) -> CommandResult + 'static,
    ) -> Self {
        let name = name.into();
        assert!(
            !self.commands.iter().any(|command| command.name == name),
            "palamedes-plugin: command \"{name}\" is already registered"
        );
        self.commands.push(Command {
            name,
            description: description.into(),
            handler: Box::new(handler),
        });
        self
    }

    /// Reads the host request from stdin, answers on stdout, and returns the
    /// process exit code. Call this from `main`.
    pub fn run(self) -> ExitCode {
        let mut input = String::new();
        if let Err(error) = std::io::stdin().read_to_string(&mut input) {
            eprintln!("palamedes-plugin: could not read the host request: {error}");
            return ExitCode::FAILURE;
        }
        let stdout = std::io::stdout();
        ExitCode::from(self.dispatch(&input, stdout.lock()))
    }

    /// Answers one host request read from `input`, writing protocol events to
    /// `output`. Returns the exit code `run` would exit with. Exposed for
    /// testing plugins without spawning a process.
    pub fn dispatch(&self, input: &str, mut output: impl Write) -> u8 {
        let request: Request = match serde_json::from_str(input) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("palamedes-plugin: invalid host request: {error}");
                return 1;
            }
        };

        match request.kind {
            RequestKind::Describe => {
                let commands: BTreeMap<String, ManifestCommand> = self
                    .commands
                    .iter()
                    .map(|command| {
                        (
                            command.name.clone(),
                            ManifestCommand {
                                description: command.description.clone(),
                            },
                        )
                    })
                    .collect();
                let manifest = Event::Manifest {
                    name: self.name.clone(),
                    protocol_version: PROTOCOL_VERSION,
                    commands,
                };
                if write_event(&mut output, &manifest).is_err() {
                    return 1;
                }
                0
            }
            RequestKind::Run => {
                // A describe request is answered regardless of version — the
                // manifest's protocolVersion is how the host detects a
                // mismatch. A run request past that negotiation must match.
                if request.protocol_version != PROTOCOL_VERSION {
                    let diagnostic = Event::Diagnostic {
                        severity: Severity::Error,
                        message: format!(
                            "Request speaks binary plugin protocol {}; this plugin supports {PROTOCOL_VERSION}.",
                            request.protocol_version
                        ),
                        code: Some("PLUGIN_PROTOCOL_INCOMPATIBLE".to_owned()),
                        details: None,
                    };
                    let result = Event::Result {
                        text: None,
                        data: None,
                        exit_code: 1,
                    };
                    if write_event(&mut output, &diagnostic).is_err()
                        || write_event(&mut output, &result).is_err()
                    {
                        return 1;
                    }
                    return 1;
                }
                self.dispatch_run(&request, &mut output)
            }
        }
    }

    fn dispatch_run(&self, request: &Request, output: &mut dyn Write) -> u8 {
        let Some(command) = self
            .commands
            .iter()
            .find(|command| command.name == request.command)
        else {
            let diagnostic = Event::Diagnostic {
                severity: Severity::Error,
                message: format!(
                    "Plugin \"{}\" has no command \"{}\".",
                    self.name, request.command
                ),
                code: Some("PLUGIN_COMMAND_UNKNOWN".to_owned()),
                details: None,
            };
            let result = Event::Result {
                text: None,
                data: None,
                exit_code: 2,
            };
            if write_event(output, &diagnostic).is_err() || write_event(output, &result).is_err() {
                return 1;
            }
            return 2;
        };

        let mut context = CommandContext {
            request,
            output,
            errored: false,
            write_failed: false,
        };
        let outcome = (command.handler)(&mut context);
        if context.write_failed {
            return 1;
        }

        let exit_code = outcome
            .exit_code
            .unwrap_or(if context.errored { 1 } else { 0 });
        let result = Event::Result {
            text: outcome.text,
            data: outcome.data,
            exit_code,
        };
        if write_event(output, &result).is_err() {
            return 1;
        }
        exit_code
    }
}

/// The invocation context a command handler receives.
pub struct CommandContext<'a> {
    request: &'a Request,
    output: &'a mut dyn Write,
    errored: bool,
    write_failed: bool,
}

impl CommandContext<'_> {
    /// Positional command arguments after host option parsing.
    pub fn args(&self) -> &[String] {
        &self.request.args
    }

    /// The options value from the plugin's configuration tuple.
    pub fn options(&self) -> &Value {
        &self.request.options
    }

    /// The resolved Palamedes configuration as JSON.
    pub fn config(&self) -> &Value {
        &self.request.config
    }

    /// Semantic catalog enumeration with absolute per-locale paths.
    pub fn catalogs(&self) -> &[Catalog] {
        &self.request.catalogs
    }

    /// True when the invocation runs with `--json`.
    pub fn json(&self) -> bool {
        self.request.json
    }

    /// False for JSON output, CI, and non-TTY execution. The host never
    /// prompts; only prompt when this is true.
    pub fn interactive(&self) -> bool {
        self.request.interactive
    }

    /// Version of the `@palamedes/cli` host package.
    pub fn host_version(&self) -> &str {
        &self.request.host_version
    }

    /// Streams a line of human-readable output through the host.
    pub fn output(&mut self, text: impl Into<String>) {
        self.write(&Event::Output { text: text.into() });
    }

    /// Records an informational diagnostic.
    pub fn info(&mut self, code: impl Into<String>, message: impl Into<String>) {
        self.diagnostic(Severity::Info, Some(code.into()), message, None);
    }

    /// Records a warning diagnostic.
    pub fn warning(&mut self, code: impl Into<String>, message: impl Into<String>) {
        self.diagnostic(Severity::Warning, Some(code.into()), message, None);
    }

    /// Records an error diagnostic. Without an explicit result exit code, any
    /// error diagnostic makes the command exit with 1.
    pub fn error(&mut self, code: impl Into<String>, message: impl Into<String>) {
        self.diagnostic(Severity::Error, Some(code.into()), message, None);
    }

    /// Records a diagnostic with full control over code and details.
    pub fn diagnostic(
        &mut self,
        severity: Severity,
        code: Option<String>,
        message: impl Into<String>,
        details: Option<Value>,
    ) {
        if severity == Severity::Error {
            self.errored = true;
        }
        self.write(&Event::Diagnostic {
            severity,
            message: message.into(),
            code,
            details,
        });
    }

    /// The absolute path of the native `pmds` executable, when the host provided
    /// one via [`NATIVE_EXECUTABLE_ENV`].
    pub fn native_executable(&self) -> Option<PathBuf> {
        env::var_os(NATIVE_EXECUTABLE_ENV).map(PathBuf::from)
    }

    /// A prepared subprocess invocation of a documented built-in command
    /// (`extract`, `audit`, `report`, `catalog`, `version`), or `None` when
    /// the host did not provide the sidecar path. The plugin decides how to
    /// run it; with `--json` it should capture the output instead of letting
    /// it reach the plugin's own stdout.
    pub fn built_in_command<I, S>(&self, args: I) -> Option<std::process::Command>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let executable = self.native_executable()?;
        let mut command = std::process::Command::new(executable);
        command.args(args);
        Some(command)
    }

    fn write(&mut self, event: &Event) {
        if write_event(&mut self.output, event).is_err() {
            self.write_failed = true;
        }
    }
}

/// What a command handler returns: optional text, structured data, and an
/// explicit exit code. Without an explicit exit code, error diagnostics
/// produce 1 and other results produce 0.
#[derive(Debug, Default)]
pub struct CommandResult {
    text: Option<String>,
    data: Option<Value>,
    exit_code: Option<u8>,
}

impl CommandResult {
    /// Sets the human-readable result text.
    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    /// Sets the structured result data, returned as `result` in JSON mode.
    pub fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }

    /// Sets an explicit exit code from 0 through 255.
    pub fn with_exit_code(mut self, exit_code: u8) -> Self {
        self.exit_code = Some(exit_code);
        self
    }
}

fn write_event(output: &mut dyn Write, event: &Event) -> std::io::Result<()> {
    let mut line = serde_json::to_string(event).map_err(std::io::Error::other)?;
    line.push('\n');
    output.write_all(line.as_bytes())
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    fn fixture_plugin() -> Plugin {
        Plugin::new("acme")
            .command("inspect", "Inspect configured catalogs.", |context| {
                context.info(
                    "ACME_INSPECTED",
                    format!(
                        "Inspected {} catalog definitions.",
                        context.catalogs().len()
                    ),
                );
                context.output("inspecting");
                CommandResult::default()
                    .with_text("done")
                    .with_data(json!({ "args": context.args(), "options": context.options() }))
            })
            .command("fail", "Report a failure.", |context| {
                context.error("ACME_FAILED", "Workflow failed.");
                CommandResult::default()
            })
            .command("exit-nine", "Use an explicit exit code.", |_context| {
                CommandResult::default().with_exit_code(9)
            })
    }

    fn dispatch(plugin: &Plugin, request: &Value) -> (u8, Vec<Value>) {
        let mut output = Vec::new();
        let exit_code = plugin.dispatch(&request.to_string(), &mut output);
        let events = String::from_utf8(output)
            .expect("protocol output is UTF-8")
            .lines()
            .map(|line| serde_json::from_str(line).expect("protocol lines are JSON"))
            .collect();
        (exit_code, events)
    }

    fn run_request(command: &str) -> Value {
        json!({
            "palamedesBinaryPluginProtocol": 1,
            "hostVersion": "1.8.0",
            "kind": "run",
            "command": command,
            "args": ["one", "two"],
            "options": { "policy": "strict" },
            "json": false,
            "interactive": false,
            "config": { "rootDir": "/project" },
            "catalogs": [{
                "path": "locales/{locale}/messages",
                "format": "po",
                "include": ["src"],
                "exclude": [],
                "locales": [
                    { "locale": "en", "path": "/project/locales/en/messages" },
                    { "locale": "de", "path": "/project/locales/de/messages" }
                ]
            }]
        })
    }

    #[test]
    fn describe_emits_one_manifest() {
        let request = json!({
            "palamedesBinaryPluginProtocol": 1,
            "hostVersion": "1.8.0",
            "kind": "describe"
        });
        let (exit_code, events) = dispatch(&fixture_plugin(), &request);

        assert_eq!(exit_code, 0);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["event"], "manifest");
        assert_eq!(events[0]["name"], "acme");
        assert_eq!(events[0]["protocolVersion"], 1);
        assert_eq!(
            events[0]["commands"]["inspect"]["description"],
            "Inspect configured catalogs."
        );
        assert_eq!(
            events[0]["commands"]["fail"]["description"],
            "Report a failure."
        );
    }

    #[test]
    fn run_streams_events_and_result() {
        let (exit_code, events) = dispatch(&fixture_plugin(), &run_request("inspect"));

        assert_eq!(exit_code, 0);
        assert_eq!(events.len(), 3);
        assert_eq!(events[0]["event"], "diagnostic");
        assert_eq!(events[0]["severity"], "info");
        assert_eq!(events[0]["code"], "ACME_INSPECTED");
        assert_eq!(events[0]["message"], "Inspected 1 catalog definitions.");
        assert_eq!(
            events[1],
            json!({ "event": "output", "text": "inspecting" })
        );
        assert_eq!(
            events[2],
            json!({
                "event": "result",
                "text": "done",
                "data": { "args": ["one", "two"], "options": { "policy": "strict" } },
                "exitCode": 0
            })
        );
    }

    #[test]
    fn error_diagnostics_default_the_exit_code_to_one() {
        let (exit_code, events) = dispatch(&fixture_plugin(), &run_request("fail"));

        assert_eq!(exit_code, 1);
        assert_eq!(events.last().unwrap()["exitCode"], 1);
    }

    #[test]
    fn explicit_exit_codes_are_preserved() {
        let (exit_code, events) = dispatch(&fixture_plugin(), &run_request("exit-nine"));

        assert_eq!(exit_code, 9);
        assert_eq!(
            events.last().unwrap(),
            &json!({ "event": "result", "exitCode": 9 })
        );
    }

    #[test]
    fn unknown_commands_answer_with_a_result() {
        let (exit_code, events) = dispatch(&fixture_plugin(), &run_request("missing"));

        assert_eq!(exit_code, 2);
        assert_eq!(events[0]["event"], "diagnostic");
        assert_eq!(events[0]["code"], "PLUGIN_COMMAND_UNKNOWN");
        assert_eq!(events[1], json!({ "event": "result", "exitCode": 2 }));
    }

    #[test]
    #[should_panic(expected = "command \"inspect\" is already registered")]
    fn duplicate_command_names_are_rejected_at_registration() {
        let _ =
            fixture_plugin().command("inspect", "Duplicate.", |_context| CommandResult::default());
    }

    #[test]
    fn run_requests_with_a_foreign_protocol_version_are_rejected() {
        let mut request = run_request("inspect");
        request["palamedesBinaryPluginProtocol"] = json!(2);
        let (exit_code, events) = dispatch(&fixture_plugin(), &request);

        assert_eq!(exit_code, 1);
        assert_eq!(events[0]["event"], "diagnostic");
        assert_eq!(events[0]["code"], "PLUGIN_PROTOCOL_INCOMPATIBLE");
        assert_eq!(events[1], json!({ "event": "result", "exitCode": 1 }));
    }

    #[test]
    fn describe_answers_regardless_of_the_requested_protocol_version() {
        let request = json!({
            "palamedesBinaryPluginProtocol": 2,
            "hostVersion": "9.0.0",
            "kind": "describe"
        });
        let (exit_code, events) = dispatch(&fixture_plugin(), &request);

        assert_eq!(exit_code, 0);
        assert_eq!(events[0]["event"], "manifest");
        assert_eq!(events[0]["protocolVersion"], 1);
    }

    #[test]
    fn invalid_requests_fail_without_protocol_output() {
        let mut output = Vec::new();
        let exit_code = fixture_plugin().dispatch("not json", &mut output);

        assert_eq!(exit_code, 1);
        assert!(output.is_empty());
    }

    #[test]
    fn host_request_shape_parses_into_typed_context() {
        let request: Request =
            serde_json::from_str(&run_request("inspect").to_string()).expect("request parses");

        assert_eq!(request.protocol_version, PROTOCOL_VERSION);
        assert_eq!(request.host_version, "1.8.0");
        assert_eq!(request.kind, RequestKind::Run);
        assert_eq!(request.command, "inspect");
        assert_eq!(request.args, ["one", "two"]);
        assert!(!request.json);
        assert!(!request.interactive);
        assert_eq!(request.config["rootDir"], "/project");
        assert_eq!(request.catalogs.len(), 1);
        assert_eq!(request.catalogs[0].format, "po");
        assert_eq!(request.catalogs[0].locales[1].locale, "de");
        assert_eq!(
            request.catalogs[0].locales[1].path,
            "/project/locales/de/messages"
        );
    }
}
