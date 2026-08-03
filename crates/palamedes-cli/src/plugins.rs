//! Native dispatch for explicit binary plugin commands.
//!
//! Built-ins stay in the Clap command tree and reach this module only for an
//! external namespace. Binary plugins are resolved from the data config,
//! described over the versioned stdio protocol, and then run as child
//! processes. No JavaScript module or executable config is loaded here.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::command::Context;
use crate::config::LoadedConfig;

const BUILT_IN_NAMESPACES: &[&str] = &["extract", "audit", "report", "catalog", "version"];
const PROTOCOL_VERSION: u64 = palamedes_plugin::PROTOCOL_VERSION;
const NATIVE_EXECUTABLE_ENV: &str = palamedes_plugin::NATIVE_EXECUTABLE_ENV;

/// Dispatches one external Clap subcommand through the binary plugin host.
pub fn run(args: &[String], context: &Context) -> u8 {
    let hint = InvocationHint::from_args(args);
    let invocation = match PluginInvocation::parse(args) {
        Ok(invocation) => invocation,
        Err(failure) => return emit_failure(&hint, &failure),
    };

    match run_invocation(&invocation, context) {
        Ok(output) => {
            emit_result(&invocation, &output);
            output.exit_code
        }
        Err(failure) => emit_failure(&InvocationHint::from(&invocation), &failure),
    }
}

fn run_invocation(
    invocation: &PluginInvocation,
    context: &Context,
) -> Result<PluginOutput, PluginFailure> {
    let config = context
        .load_config(invocation.config_path.as_deref())
        .map_err(|error| PluginFailure::new("PLUGIN_CONFIG_FAILED", error.to_string()))?;
    if config.plugins.is_empty() {
        return Err(PluginFailure::with_exit_code(
            "PLUGIN_NAMESPACE_UNKNOWN",
            format!(
                "No configured Palamedes binary plugin declares the namespace \"{}\".",
                invocation.namespace
            ),
            2,
        ));
    }

    let cwd = env::current_dir().map_err(|error| {
        PluginFailure::new(
            "PLUGIN_HOST_FAILED",
            format!("Could not determine the current directory: {error}"),
        )
    })?;
    let native_executable = env::current_exe().map_err(|error| {
        PluginFailure::new(
            "PLUGIN_HOST_FAILED",
            format!("Could not resolve the running pmds executable: {error}"),
        )
    })?;
    let registry = load_registry(&config, &cwd, &native_executable)?;
    let Some(plugin) = registry.get(&invocation.namespace) else {
        return Err(PluginFailure::with_exit_code(
            "PLUGIN_NAMESPACE_UNKNOWN",
            format!(
                "No configured Palamedes binary plugin declares the namespace \"{}\".",
                invocation.namespace
            ),
            2,
        ));
    };

    if !plugin.manifest.commands.contains_key(&invocation.command) {
        let available = plugin
            .manifest
            .commands
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        return Err(PluginFailure::new(
            "PLUGIN_COMMAND_UNKNOWN",
            format!(
                "Plugin \"{}\" has no command \"{}\". Available commands: {}.",
                invocation.namespace,
                invocation.command,
                if available.is_empty() {
                    "none"
                } else {
                    &available
                }
            ),
        ));
    }

    let request = json!({
        "palamedesBinaryPluginProtocol": PROTOCOL_VERSION,
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "kind": "run",
        "command": invocation.command,
        "args": invocation.command_args,
        "options": plugin.options,
        "json": invocation.json,
        "interactive": is_interactive(invocation.json),
        "config": serde_json::to_value(&config).map_err(|error| {
            PluginFailure::new(
                "PLUGIN_HOST_FAILED",
                format!("Could not serialize the resolved Palamedes config: {error}"),
            )
        })?,
        "catalogs": plugin_catalogs(&config),
    });
    let result = invoke_binary(&plugin.resolved, &request, &cwd, &native_executable)?;
    finish_run(&plugin.resolved, result)
}

fn load_registry(
    config: &LoadedConfig,
    cwd: &Path,
    native_executable: &Path,
) -> Result<BTreeMap<String, LoadedPlugin>, PluginFailure> {
    let mut registry = BTreeMap::new();
    for declaration in &config.plugins {
        let resolved = resolve_binary_plugin(declaration.specifier(), &config.config_path)?;
        let request = json!({
            "palamedesBinaryPluginProtocol": PROTOCOL_VERSION,
            "hostVersion": env!("CARGO_PKG_VERSION"),
            "kind": "describe",
        });
        let invocation = invoke_binary(&resolved, &request, cwd, native_executable)?;
        let manifest = manifest_from_invocation(&resolved, invocation)?;
        validate_manifest(&resolved, &manifest)?;
        let namespace = manifest.name.clone();
        if registry.contains_key(&namespace) {
            return Err(PluginFailure::new(
                "PLUGIN_NAMESPACE_COLLISION",
                format!("Multiple configured plugins declare the namespace \"{namespace}\"."),
            ));
        }
        registry.insert(
            namespace,
            LoadedPlugin {
                resolved,
                manifest,
                options: declaration.options(),
            },
        );
    }
    Ok(registry)
}

fn manifest_from_invocation(
    resolved: &ResolvedPlugin,
    invocation: BinaryInvocation,
) -> Result<PluginManifest, PluginFailure> {
    if invocation.exit_code != 0 {
        return Err(protocol_failure(
            resolved,
            format!("describe failed with exit code {}", invocation.exit_code),
        ));
    }
    let mut manifests = invocation
        .events
        .into_iter()
        .filter_map(|event| match event {
            PluginEvent::Manifest(manifest) => Some(manifest),
            _ => None,
        });
    let Some(manifest) = manifests.next() else {
        return Err(protocol_failure(
            resolved,
            "describe must emit exactly one manifest event",
        ));
    };
    if manifests.next().is_some() {
        return Err(protocol_failure(
            resolved,
            "describe must emit exactly one manifest event",
        ));
    }
    Ok(manifest)
}

fn validate_manifest(
    resolved: &ResolvedPlugin,
    manifest: &PluginManifest,
) -> Result<(), PluginFailure> {
    if manifest.protocol_version != PROTOCOL_VERSION {
        return Err(PluginFailure::new(
            "PLUGIN_PROTOCOL_INCOMPATIBLE",
            format!(
                "Binary plugin \"{}\" requires binary plugin protocol {}; this CLI supports {}.",
                resolved.specifier, manifest.protocol_version, PROTOCOL_VERSION
            ),
        ));
    }
    if !is_kebab_name(&manifest.name) {
        return Err(PluginFailure::new(
            "PLUGIN_INVALID",
            format!(
                "Binary plugin \"{}\" must declare a lowercase kebab-case namespace.",
                resolved.specifier
            ),
        ));
    }
    if BUILT_IN_NAMESPACES.contains(&manifest.name.as_str()) {
        return Err(PluginFailure::new(
            "PLUGIN_NAMESPACE_COLLISION",
            format!(
                "Plugin namespace \"{}\" collides with a built-in pmds command.",
                manifest.name
            ),
        ));
    }
    for command in manifest.commands.keys() {
        if !is_kebab_name(command) {
            return Err(PluginFailure::new(
                "PLUGIN_INVALID",
                format!(
                    "Binary plugin \"{}\" declares invalid command \"{command}\".",
                    resolved.specifier
                ),
            ));
        }
    }
    Ok(())
}

fn finish_run(
    resolved: &ResolvedPlugin,
    invocation: BinaryInvocation,
) -> Result<PluginOutput, PluginFailure> {
    let mut diagnostics = Vec::new();
    let mut outputs = Vec::new();
    let mut result = None;

    for event in invocation.events {
        match event {
            PluginEvent::Manifest(_) => {
                return Err(protocol_failure(
                    resolved,
                    "run must not emit a manifest event",
                ));
            }
            PluginEvent::Diagnostic(diagnostic) => diagnostics.push(diagnostic),
            PluginEvent::Output(text) => outputs.push(text),
            PluginEvent::Result(candidate) => {
                if result.replace(candidate).is_some() {
                    return Err(protocol_failure(
                        resolved,
                        "run must emit at most one result event",
                    ));
                }
            }
        }
    }

    let Some(result) = result else {
        let exit_code = if invocation.exit_code == 0 {
            1
        } else {
            invocation.exit_code
        };
        diagnostics.push(PluginDiagnostic {
            severity: Severity::Error,
            code: Some("PLUGIN_BINARY_PROTOCOL".to_owned()),
            message: format!(
                "Binary plugin \"{}\" exited with code {} without emitting a result event.",
                resolved.specifier, invocation.exit_code
            ),
            details: None,
        });
        return Ok(PluginOutput {
            outputs,
            text: None,
            data: None,
            exit_code,
            diagnostics,
        });
    };

    let exit_code = result.exit_code.unwrap_or_else(|| {
        if diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == Severity::Error)
        {
            1
        } else {
            0
        }
    });
    Ok(PluginOutput {
        outputs,
        text: result.text,
        data: result.data,
        exit_code,
        diagnostics,
    })
}

fn invoke_binary(
    resolved: &ResolvedPlugin,
    request: &Value,
    cwd: &Path,
    native_executable: &Path,
) -> Result<BinaryInvocation, PluginFailure> {
    let mut request_bytes = serde_json::to_vec(request).map_err(|error| {
        PluginFailure::new(
            "PLUGIN_BINARY_PROTOCOL",
            format!(
                "Could not serialize a request for binary plugin \"{}\": {error}",
                resolved.specifier
            ),
        )
    })?;
    request_bytes.push(b'\n');
    let mut child = Command::new(&resolved.binary_path)
        .current_dir(cwd)
        .env(NATIVE_EXECUTABLE_ENV, native_executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            PluginFailure::new(
                "PLUGIN_BINARY_SPAWN_FAILED",
                format!(
                    "Could not run binary plugin \"{}\" at {}: {error}",
                    resolved.specifier,
                    resolved.binary_path.display()
                ),
            )
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(&request_bytes) {
            // A plugin may terminate before consuming its request. Preserve its
            // real exit status and protocol output instead of replacing those
            // with the resulting closed-pipe error.
            if error.kind() != io::ErrorKind::BrokenPipe {
                let _ = child.kill();
                let _ = child.wait();
                return Err(PluginFailure::new(
                    "PLUGIN_BINARY_PROTOCOL",
                    format!(
                        "Could not write a request to binary plugin \"{}\": {error}",
                        resolved.specifier
                    ),
                ));
            }
        }
    }

    let mut stdout = String::new();
    child
        .stdout
        .take()
        .expect("piped plugin stdout")
        .read_to_string(&mut stdout)
        .map_err(|error| {
            PluginFailure::new(
                "PLUGIN_BINARY_PROTOCOL",
                format!(
                    "Could not read binary plugin \"{}\" output: {error}",
                    resolved.specifier
                ),
            )
        })?;
    let status = child.wait().map_err(|error| {
        PluginFailure::new(
            "PLUGIN_BINARY_SPAWN_FAILED",
            format!(
                "Could not wait for binary plugin \"{}\": {error}",
                resolved.specifier
            ),
        )
    })?;

    Ok(BinaryInvocation {
        exit_code: exit_code(status),
        events: parse_events(&stdout, resolved)?,
    })
}

fn parse_events(
    stdout: &str,
    resolved: &ResolvedPlugin,
) -> Result<Vec<PluginEvent>, PluginFailure> {
    stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let value: Value = serde_json::from_str(line).map_err(|_| {
                protocol_failure(resolved, format!("invalid JSON event line: {line}"))
            })?;
            parse_event(value).map_err(|detail| protocol_failure(resolved, detail))
        })
        .collect()
}

fn parse_event(value: Value) -> Result<PluginEvent, String> {
    let kind = value
        .get("event")
        .and_then(Value::as_str)
        .ok_or_else(|| "event lines must be objects with an \"event\" kind".to_owned())?;
    match kind {
        "manifest" => serde_json::from_value(value)
            .map(PluginEvent::Manifest)
            .map_err(|error| format!("invalid manifest event: {error}")),
        "diagnostic" => serde_json::from_value(value)
            .map(PluginEvent::Diagnostic)
            .map_err(|error| format!("invalid diagnostic event: {error}")),
        "output" => value
            .get("text")
            .and_then(Value::as_str)
            .map(|text| PluginEvent::Output(text.to_owned()))
            .ok_or_else(|| "output events must contain string text".to_owned()),
        "result" => {
            let text = value
                .get("text")
                .map(|text| {
                    text.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| "result text must be a string".to_owned())
                })
                .transpose()?;
            let data = value.get("data").cloned();
            let exit_code = value
                .get("exitCode")
                .map(|code| {
                    code.as_u64()
                        .filter(|code| *code <= u8::MAX.into())
                        .map(|code| code as u8)
                        .ok_or_else(|| {
                            "result exitCode must be an integer from 0 to 255".to_owned()
                        })
                })
                .transpose()?;
            Ok(PluginEvent::Result(PluginResult {
                text,
                data,
                exit_code,
            }))
        }
        other => Err(format!("unknown event \"{other}\"")),
    }
}

fn resolve_binary_plugin(
    specifier: &str,
    config_path: &Path,
) -> Result<ResolvedPlugin, PluginFailure> {
    let config_dir = config_path.parent().unwrap_or_else(|| Path::new("."));
    if is_path_specifier(specifier) {
        let candidate = if Path::new(specifier).is_absolute() {
            PathBuf::from(specifier)
        } else {
            config_dir.join(specifier)
        };
        if candidate.is_file() {
            return resolved_executable(specifier, candidate);
        }
        if candidate.is_dir() {
            return resolve_package_plugin(specifier, candidate);
        }
        return Err(PluginFailure::new(
            "PLUGIN_MISSING",
            format!(
                "Configured Palamedes binary plugin \"{specifier}\" does not exist relative to {}.",
                config_path.display()
            ),
        ));
    }

    let package_dir = locate_package_dir(specifier, config_dir).ok_or_else(|| {
        PluginFailure::new(
            "PLUGIN_MISSING",
            format!(
                "Could not resolve configured Palamedes binary plugin package \"{specifier}\" from {}.",
                config_path.display()
            ),
        )
    })?;
    resolve_package_plugin(specifier, package_dir)
}

fn resolve_package_plugin(
    specifier: &str,
    package_dir: PathBuf,
) -> Result<ResolvedPlugin, PluginFailure> {
    let manifest = read_package_manifest(&package_dir).map_err(|error| {
        PluginFailure::new(
            "PLUGIN_INVALID",
            format!(
                "Could not read binary plugin package \"{specifier}\" at {}: {error}",
                package_dir.display()
            ),
        )
    })?;
    if let Some(binary) = manifest
        .palamedes
        .as_ref()
        .and_then(|palamedes| palamedes.plugin_binary.as_deref())
    {
        return resolved_executable(specifier, package_dir.join(binary));
    }

    let canonical_dir = fs::canonicalize(&package_dir).unwrap_or(package_dir);
    let mut candidates = Vec::new();
    for dependency in manifest.optional_dependencies.keys() {
        let Some(dependency_dir) = locate_package_dir(dependency, &canonical_dir) else {
            continue;
        };
        let Ok(dependency_manifest) = read_package_manifest(&dependency_dir) else {
            continue;
        };
        if !package_supports_current_target(&dependency_manifest) {
            continue;
        }
        let Some(binary) = dependency_manifest
            .palamedes
            .as_ref()
            .and_then(|palamedes| palamedes.plugin_binary.as_deref())
        else {
            continue;
        };
        candidates.push(dependency_dir.join(binary));
    }

    match candidates.as_slice() {
        [binary] => resolved_executable(specifier, binary.clone()),
        [] => Err(PluginFailure::new(
            "PLUGIN_BINARY_MISSING",
            format!(
                "Binary plugin package \"{specifier}\" does not declare palamedes.pluginBinary and has no installed platform package that does."
            ),
        )),
        _ => Err(PluginFailure::new(
            "PLUGIN_BINARY_AMBIGUOUS",
            format!(
                "Binary plugin package \"{specifier}\" resolves more than one executable for this platform."
            ),
        )),
    }
}

fn resolved_executable(
    specifier: &str,
    binary_path: PathBuf,
) -> Result<ResolvedPlugin, PluginFailure> {
    if matches!(
        binary_path
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("js" | "mjs" | "cjs" | "ts")
    ) {
        return Err(PluginFailure::new(
            "PLUGIN_BINARY_REQUIRED",
            format!(
                "Configured plugin \"{specifier}\" points to {}. Palamedes CLI plugins must be native executables.",
                binary_path.display()
            ),
        ));
    }
    if !binary_path.is_file() {
        return Err(PluginFailure::new(
            "PLUGIN_BINARY_MISSING",
            format!(
                "Configured plugin \"{specifier}\" has no executable at {}.",
                binary_path.display()
            ),
        ));
    }
    Ok(ResolvedPlugin {
        specifier: specifier.to_owned(),
        binary_path,
    })
}

fn locate_package_dir(specifier: &str, start: &Path) -> Option<PathBuf> {
    let segments = package_segments(specifier)?;
    for ancestor in start.ancestors() {
        let mut candidate = ancestor.join("node_modules");
        for segment in &segments {
            candidate.push(segment);
        }
        if candidate.join("package.json").is_file() {
            return Some(candidate);
        }
    }
    None
}

fn package_segments(specifier: &str) -> Option<Vec<&str>> {
    let segments = specifier.split('/').collect::<Vec<_>>();
    match (specifier.starts_with('@'), segments.as_slice()) {
        (true, [scope, package]) if scope.len() > 1 && !package.is_empty() => Some(segments),
        (false, [package]) if !package.is_empty() => Some(segments),
        _ => None,
    }
}

fn read_package_manifest(package_dir: &Path) -> Result<PackageManifest, io::Error> {
    let contents = fs::read_to_string(package_dir.join("package.json"))?;
    serde_json::from_str(&contents).map_err(io::Error::other)
}

fn package_supports_current_target(manifest: &PackageManifest) -> bool {
    matches_constraint(&manifest.os, target_os())
        && matches_constraint(&manifest.cpu, target_cpu())
        && target_libc().is_none_or(|libc| matches_constraint(&manifest.libc, libc))
}

fn matches_constraint(values: &[String], current: &str) -> bool {
    if values.iter().any(|value| value == &format!("!{current}")) {
        return false;
    }
    let positives = values
        .iter()
        .filter(|value| !value.starts_with('!'))
        .collect::<Vec<_>>();
    positives.is_empty() || positives.iter().any(|value| value.as_str() == current)
}

fn target_os() -> &'static str {
    match env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

fn target_cpu() -> &'static str {
    match env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
}

fn target_libc() -> Option<&'static str> {
    if cfg!(all(target_os = "linux", target_env = "musl")) {
        Some("musl")
    } else if cfg!(target_os = "linux") {
        Some("glibc")
    } else {
        None
    }
}

fn is_path_specifier(specifier: &str) -> bool {
    specifier.starts_with("./")
        || specifier.starts_with("../")
        || Path::new(specifier).is_absolute()
}

fn is_kebab_name(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && chars.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

fn plugin_catalogs(config: &LoadedConfig) -> Value {
    Value::Array(
        config
            .catalogs
            .iter()
            .map(|catalog| {
                json!({
                    "path": catalog.path,
                    "format": catalog.format,
                    "include": catalog.include,
                    "exclude": catalog.exclude,
                    "locales": config.locales.iter().map(|locale| json!({
                        "locale": locale,
                        "path": config.root_dir.join(catalog.path.replace("{locale}", locale)),
                    })).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}

fn emit_result(invocation: &PluginInvocation, output: &PluginOutput) {
    if invocation.json {
        let text = output
            .outputs
            .iter()
            .chain(output.text.iter())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let result = output.data.clone().unwrap_or({
            if text.is_empty() {
                Value::Null
            } else {
                Value::String(text)
            }
        });
        println!(
            "{}",
            serde_json::to_string(&json!({
                "ok": output.exit_code == 0,
                "plugin": invocation.namespace,
                "command": invocation.command,
                "exitCode": output.exit_code,
                "result": result,
                "diagnostics": output.diagnostics,
            }))
            .expect("plugin result JSON")
        );
        return;
    }

    for text in &output.outputs {
        println!("{text}");
    }
    if let Some(text) = &output.text {
        println!("{text}");
    } else if output.outputs.is_empty() {
        if let Some(data) = &output.data {
            println!(
                "{}",
                serde_json::to_string_pretty(data).expect("plugin data JSON")
            );
        }
    }
    for diagnostic in &output.diagnostics {
        eprintln!("{}", diagnostic.display());
    }
}

fn emit_failure(invocation: &InvocationHint, failure: &PluginFailure) -> u8 {
    let diagnostic = PluginDiagnostic {
        severity: Severity::Error,
        code: Some(failure.code.to_owned()),
        message: failure.message.clone(),
        details: None,
    };
    if invocation.json {
        println!(
            "{}",
            serde_json::to_string(&json!({
                "ok": false,
                "plugin": invocation.namespace,
                "command": invocation.command,
                "exitCode": failure.exit_code,
                "result": Value::Null,
                "diagnostics": [diagnostic],
            }))
            .expect("plugin failure JSON")
        );
    } else {
        eprintln!("{}", diagnostic.display());
    }
    failure.exit_code
}

fn is_interactive(json: bool) -> bool {
    !json && io::stdin().is_terminal() && io::stdout().is_terminal() && env::var_os("CI").is_none()
}

fn exit_code(status: ExitStatus) -> u8 {
    if let Some(code) = status.code() {
        return u8::try_from(code).unwrap_or(1);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        match status.signal() {
            Some(2) => 130,
            Some(15) => 143,
            _ => 1,
        }
    }
    #[cfg(not(unix))]
    1
}

fn protocol_failure(resolved: &ResolvedPlugin, detail: impl AsRef<str>) -> PluginFailure {
    PluginFailure::new(
        "PLUGIN_BINARY_PROTOCOL",
        format!(
            "Binary plugin \"{}\" violated the binary plugin protocol: {}.",
            resolved.specifier,
            detail.as_ref()
        ),
    )
}

#[derive(Debug)]
struct PluginInvocation {
    namespace: String,
    command: String,
    command_args: Vec<String>,
    config_path: Option<PathBuf>,
    json: bool,
}

impl PluginInvocation {
    fn parse(args: &[String]) -> Result<Self, PluginFailure> {
        let namespace = args.first().cloned().ok_or_else(|| {
            PluginFailure::new("PLUGIN_ARGUMENT_INVALID", "Plugin namespace is required.")
        })?;
        let command = args.get(1).cloned().ok_or_else(|| {
            PluginFailure::new(
                "PLUGIN_COMMAND_REQUIRED",
                format!("Plugin namespace \"{namespace}\" requires a command name."),
            )
        })?;
        let mut command_args = Vec::new();
        let mut config_path = None;
        let mut json = false;
        let mut passthrough = false;
        let mut index = 2;
        while index < args.len() {
            let value = &args[index];
            if passthrough {
                command_args.push(value.clone());
            } else if value == "--" {
                passthrough = true;
            } else if value == "--json" {
                json = true;
            } else if value == "--config" || value == "-c" {
                let next = args.get(index + 1).filter(|next| !next.starts_with('-'));
                let Some(next) = next else {
                    return Err(PluginFailure::new(
                        "PLUGIN_ARGUMENT_INVALID",
                        format!("{value} requires a path."),
                    ));
                };
                config_path = Some(PathBuf::from(next));
                index += 1;
            } else if let Some(path) = value.strip_prefix("--config=") {
                if path.is_empty() {
                    return Err(PluginFailure::new(
                        "PLUGIN_ARGUMENT_INVALID",
                        "--config requires a path.",
                    ));
                }
                config_path = Some(PathBuf::from(path));
            } else {
                command_args.push(value.clone());
            }
            index += 1;
        }
        Ok(Self {
            namespace,
            command,
            command_args,
            config_path,
            json,
        })
    }
}

#[derive(Debug)]
struct InvocationHint {
    namespace: Option<String>,
    command: Option<String>,
    json: bool,
}

impl InvocationHint {
    fn from_args(args: &[String]) -> Self {
        Self {
            namespace: args.first().cloned(),
            command: args.get(1).cloned(),
            json: args.iter().any(|argument| argument == "--json"),
        }
    }
}

impl From<&PluginInvocation> for InvocationHint {
    fn from(invocation: &PluginInvocation) -> Self {
        Self {
            namespace: Some(invocation.namespace.clone()),
            command: Some(invocation.command.clone()),
            json: invocation.json,
        }
    }
}

#[derive(Debug)]
struct LoadedPlugin {
    resolved: ResolvedPlugin,
    manifest: PluginManifest,
    options: Value,
}

#[derive(Clone, Debug)]
struct ResolvedPlugin {
    specifier: String,
    binary_path: PathBuf,
}

#[derive(Debug)]
struct BinaryInvocation {
    exit_code: u8,
    events: Vec<PluginEvent>,
}

#[derive(Debug)]
enum PluginEvent {
    Manifest(PluginManifest),
    Diagnostic(PluginDiagnostic),
    Output(String),
    Result(PluginResult),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    name: String,
    protocol_version: u64,
    commands: BTreeMap<String, ManifestCommand>,
}

#[derive(Debug, Deserialize)]
struct ManifestCommand {
    #[allow(dead_code)]
    description: Option<String>,
}

#[derive(Debug)]
struct PluginResult {
    text: Option<String>,
    data: Option<Value>,
    exit_code: Option<u8>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Severity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Deserialize, Serialize)]
struct PluginDiagnostic {
    severity: Severity,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

impl PluginDiagnostic {
    fn display(&self) -> String {
        let code = self
            .code
            .as_deref()
            .map(|code| format!(" {code}"))
            .unwrap_or_default();
        format!("[{}{}] {}", self.severity.as_str(), code, self.message)
    }
}

impl Severity {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

#[derive(Debug)]
struct PluginOutput {
    outputs: Vec<String>,
    text: Option<String>,
    data: Option<Value>,
    exit_code: u8,
    diagnostics: Vec<PluginDiagnostic>,
}

#[derive(Debug)]
struct PluginFailure {
    code: &'static str,
    message: String,
    exit_code: u8,
}

impl PluginFailure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self::with_exit_code(code, message, 1)
    }

    fn with_exit_code(code: &'static str, message: impl Into<String>, exit_code: u8) -> Self {
        Self {
            code,
            message: message.into(),
            exit_code,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct PackageManifest {
    #[serde(default)]
    palamedes: Option<PackagePalamedes>,
    #[serde(default, rename = "optionalDependencies")]
    optional_dependencies: BTreeMap<String, String>,
    #[serde(default)]
    os: Vec<String>,
    #[serde(default)]
    cpu: Vec<String>,
    #[serde(default)]
    libc: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PackagePalamedes {
    #[serde(rename = "pluginBinary")]
    plugin_binary: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::{
        finish_run, is_kebab_name, matches_constraint, parse_event, resolve_binary_plugin,
        BinaryInvocation, PluginEvent, PluginInvocation, ResolvedPlugin,
    };

    #[test]
    fn parses_reserved_plugin_options_and_passthrough() {
        let invocation = PluginInvocation::parse(&[
            "acme".to_owned(),
            "inspect".to_owned(),
            "--json".to_owned(),
            "--config=palamedes.yaml".to_owned(),
            "first".to_owned(),
            "--".to_owned(),
            "--json".to_owned(),
        ])
        .expect("invocation");

        assert_eq!(invocation.namespace, "acme");
        assert_eq!(invocation.command, "inspect");
        assert_eq!(invocation.command_args, ["first", "--json"]);
        assert_eq!(
            invocation.config_path.as_deref(),
            Some(Path::new("palamedes.yaml"))
        );
        assert!(invocation.json);
    }

    #[test]
    fn parses_protocol_events_and_preserves_explicit_null_data() {
        let event = parse_event(json!({
            "event": "result",
            "text": "done",
            "data": null,
            "exitCode": 9,
        }))
        .expect("result event");
        let PluginEvent::Result(result) = event else {
            panic!("expected result event");
        };
        assert_eq!(result.text.as_deref(), Some("done"));
        assert_eq!(result.data, Some(json!(null)));
        assert_eq!(result.exit_code, Some(9));
    }

    #[test]
    fn missing_result_uses_process_exit_code_and_protocol_diagnostic() {
        let resolved = ResolvedPlugin {
            specifier: "@acme/plugin".to_owned(),
            binary_path: "/fixture/plugin".into(),
        };
        let output = finish_run(
            &resolved,
            BinaryInvocation {
                exit_code: 5,
                events: Vec::new(),
            },
        )
        .expect("fallback output");

        assert_eq!(output.exit_code, 5);
        assert_eq!(
            output.diagnostics[0].code.as_deref(),
            Some("PLUGIN_BINARY_PROTOCOL")
        );
    }

    #[test]
    fn resolves_a_direct_binary_package_relative_to_the_config() {
        let root = temp_dir("direct-package");
        let plugin = root.join("plugin");
        fs::create_dir_all(plugin.join("bin")).expect("plugin bin directory");
        fs::write(
            plugin.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./bin/acme"}}"#,
        )
        .expect("plugin manifest");
        fs::write(plugin.join("bin/acme"), "fixture").expect("plugin executable");
        let config = root.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");

        let resolved =
            resolve_binary_plugin("./plugin", &config).expect("resolved plugin executable");
        assert_eq!(resolved.binary_path, plugin.join("bin/acme"));
    }

    #[test]
    fn resolves_the_installed_platform_package_of_a_meta_plugin() {
        let root = temp_dir("platform-package");
        let modules = root.join("node_modules/@acme");
        let plugin = modules.join("plugin");
        let native = modules.join("plugin-native");
        fs::create_dir_all(native.join("bin")).expect("native plugin bin directory");
        fs::create_dir_all(&plugin).expect("plugin directory");
        fs::write(
            plugin.join("package.json"),
            r#"{"optionalDependencies":{"@acme/plugin-native":"1.0.0"}}"#,
        )
        .expect("plugin manifest");
        fs::write(
            native.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./bin/acme"}}"#,
        )
        .expect("native manifest");
        fs::write(native.join("bin/acme"), "fixture").expect("plugin executable");
        let config = root.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");

        let resolved = resolve_binary_plugin("@acme/plugin", &config)
            .expect("resolved platform plugin executable");
        assert_eq!(
            fs::canonicalize(resolved.binary_path).expect("canonical resolved binary"),
            fs::canonicalize(native.join("bin/acme")).expect("canonical expected binary")
        );
    }

    #[test]
    fn rejects_script_plugins() {
        let root = temp_dir("script-plugin");
        let script = root.join("plugin.mjs");
        fs::write(&script, "export {};").expect("script fixture");
        let config = root.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");

        let error = resolve_binary_plugin("./plugin.mjs", &config).expect_err("script rejected");
        assert_eq!(error.code, "PLUGIN_BINARY_REQUIRED");
    }

    #[test]
    fn validates_names_and_package_constraints() {
        assert!(is_kebab_name("acme-plus2"));
        assert!(!is_kebab_name("Acme"));
        assert!(!is_kebab_name("2acme"));
        assert!(matches_constraint(&[], "darwin"));
        assert!(matches_constraint(&["darwin".to_owned()], "darwin"));
        assert!(!matches_constraint(&["linux".to_owned()], "darwin"));
        assert!(!matches_constraint(&["!darwin".to_owned()], "darwin"));
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "palamedes-plugin-host-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temp directory");
        path
    }
}
