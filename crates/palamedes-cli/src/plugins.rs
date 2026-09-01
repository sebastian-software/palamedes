//! Native dispatch for explicit binary plugin commands.
//!
//! Built-ins stay in the Clap command tree and reach this module only for an
//! external namespace. Binary plugins are resolved from the data config,
//! described over the versioned stdio protocol, and then run as child
//! processes. No JavaScript module or executable config is loaded here.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, IsTerminal, Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
#[cfg(unix)]
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc;
#[cfg(unix)]
use std::sync::Once;
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};

use clap::CommandFactory;
use serde_json::{json, Value};

use palamedes_plugin::{Event as PluginEvent, PluginDiagnostic, PluginManifest, Severity};
use serde::{Deserialize, Serialize};

use crate::command::Context;
use crate::config::{ConfigError, LoadedConfig};
use crate::error::CliError;

const PROTOCOL_VERSION: u64 = palamedes_plugin::PROTOCOL_VERSION;
const NATIVE_EXECUTABLE_ENV: &str = palamedes_plugin::NATIVE_EXECUTABLE_ENV;
const PLUGIN_MANIFEST_CACHE_SCHEMA: u64 = 1;
const DESCRIBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROTOCOL_MAX_LINE_BYTES: usize = 1024 * 1024;
const PROTOCOL_MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;
const PROTOCOL_MAX_EVENTS: usize = 10_000;

fn reserved_plugin_namespaces() -> BTreeSet<String> {
    command_namespace_tokens(&mut crate::cli::Cli::command())
}

fn command_namespace_tokens(command: &mut clap::Command) -> BTreeSet<String> {
    command.build();
    command
        .get_subcommands()
        .flat_map(|subcommand| {
            std::iter::once(subcommand.get_name()).chain(subcommand.get_all_aliases())
        })
        .map(str::to_owned)
        .collect()
}

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
    let config = match context.load_config(invocation.config_path.as_deref()) {
        Ok(config) => config,
        /*
         * Clap routes every token it does not recognize here, so a mistyped
         * built-in arrives as a plugin namespace. With no config anywhere up
         * the tree nothing can declare that namespace, which makes "unknown
         * command" the honest answer — and a usage error rather than a config
         * one. Every other config failure (a named --config, an unreadable or
         * invalid file) stays a config failure: there the config is the problem
         * the user has to fix before the namespace question even arises.
         */
        Err(CliError::Config(ConfigError::NotFound)) if invocation.config_path.is_none() => {
            return Err(unknown_command_failure(&invocation.namespace))
        }
        Err(error) => {
            return Err(PluginFailure::new(
                "PLUGIN_CONFIG_FAILED",
                error.to_string(),
            ))
        }
    };
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
    let Some(plugin) = registry.plugins.get(&invocation.namespace) else {
        if registry.skipped.is_empty() {
            return Err(PluginFailure::with_exit_code(
                "PLUGIN_NAMESPACE_UNKNOWN",
                format!(
                    "No configured Palamedes binary plugin declares the namespace \"{}\".",
                    invocation.namespace
                ),
                2,
            ));
        }
        // The namespace may belong to a plugin that failed to load, so the
        // load failure is the actionable error here, not an unknown namespace.
        let mut message = format!(
            "No loaded Palamedes binary plugin declares the namespace \"{}\".",
            invocation.namespace
        );
        for skipped in &registry.skipped {
            message.push_str(&format!(
                " Configured plugin \"{}\" failed to load: {}",
                skipped.specifier, skipped.failure.message
            ));
        }
        return Err(PluginFailure::new(
            registry.skipped[0].failure.code,
            message,
        ));
    };

    // Only a resolved plugin makes a bare namespace a missing-command mistake;
    // before that it is indistinguishable from a mistyped built-in.
    let Some(command) = invocation.command.as_deref() else {
        return Err(PluginFailure::new(
            "PLUGIN_COMMAND_REQUIRED",
            format!(
                "Plugin namespace \"{}\" requires a command name.",
                invocation.namespace
            ),
        ));
    };

    if !plugin.manifest.commands.contains_key(command) {
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
                command,
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
        "command": command,
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
    let mut print_output = |text: &str| println!("{text}");
    let stream: Option<&mut dyn FnMut(&str)> = if invocation.json {
        None
    } else {
        Some(&mut print_output)
    };
    let result = invoke_binary(
        &plugin.resolved,
        &request,
        &cwd,
        &native_executable,
        stream,
        InvocationPolicy::run(invocation.plugin_timeout),
    )?;
    let mut output = finish_run(&plugin.resolved, result, !invocation.json)?;
    if !registry.skipped.is_empty() {
        let mut diagnostics = skipped_diagnostics(&registry.skipped);
        diagnostics.append(&mut output.diagnostics);
        output.diagnostics = diagnostics;
    }
    Ok(output)
}

fn skipped_diagnostics(skipped: &[SkippedPlugin]) -> Vec<PluginDiagnostic> {
    skipped
        .iter()
        .map(|skipped| PluginDiagnostic {
            severity: Severity::Warning,
            code: Some("PLUGIN_UNAVAILABLE".to_owned()),
            message: format!(
                "Configured plugin \"{}\" was skipped: {}",
                skipped.specifier, skipped.failure.message
            ),
            details: None,
        })
        .collect()
}

fn load_registry(
    config: &LoadedConfig,
    cwd: &Path,
    native_executable: &Path,
) -> Result<PluginRegistry, PluginFailure> {
    let mut registry = PluginRegistry::default();
    let mut cache = load_plugin_manifest_cache(config);
    let mut active_cache_keys = BTreeSet::new();
    let mut cache_dirty = false;
    let mut collision = None;
    for declaration in &config.plugins {
        // A plugin that cannot resolve or describe blocks only its own
        // namespace; other configured commands keep working and surface the
        // skipped plugin as a warning diagnostic.
        let resolved = match resolve_binary_plugin(declaration.specifier(), &config.config_path) {
            Ok(resolved) => resolved,
            Err(failure) => {
                registry.skipped.push(SkippedPlugin {
                    specifier: declaration.specifier().to_owned(),
                    failure,
                });
                continue;
            }
        };
        let cache_identity = plugin_cache_identity(&resolved);
        let manifest = match cache_identity.as_ref().and_then(|(key, stamp)| {
            active_cache_keys.insert(key.clone());
            cache
                .entries
                .get(key)
                .filter(|entry| &entry.stamp == stamp)
                .map(|entry| entry.manifest.clone())
                .filter(|manifest| validate_manifest(&resolved, manifest).is_ok())
        }) {
            Some(manifest) => manifest,
            None => match describe_resolved_plugin(&resolved, cwd, native_executable) {
                Ok(manifest) => {
                    if let Some((key, stamp)) = cache_identity {
                        cache.entries.insert(
                            key,
                            CachedPluginManifest {
                                stamp,
                                manifest: manifest.clone(),
                            },
                        );
                        cache_dirty = true;
                    }
                    manifest
                }
                Err(failure) => {
                    registry.skipped.push(SkippedPlugin {
                        specifier: declaration.specifier().to_owned(),
                        failure,
                    });
                    continue;
                }
            },
        };
        let namespace = manifest.name.clone();
        if registry.plugins.contains_key(&namespace) {
            collision.get_or_insert(namespace);
            continue;
        }
        registry.plugins.insert(
            namespace,
            LoadedPlugin {
                resolved,
                manifest,
                options: declaration.options(),
            },
        );
    }
    let cached_entry_count = cache.entries.len();
    cache
        .entries
        .retain(|key, _| active_cache_keys.contains(key));
    cache_dirty |= cache.entries.len() != cached_entry_count;
    if cache_dirty {
        save_plugin_manifest_cache(config, &cache);
    }
    if let Some(namespace) = collision {
        return Err(PluginFailure::new(
            "PLUGIN_NAMESPACE_COLLISION",
            format!("Multiple configured plugins declare the namespace \"{namespace}\"."),
        ));
    }
    Ok(registry)
}

fn describe_resolved_plugin(
    resolved: &ResolvedPlugin,
    cwd: &Path,
    native_executable: &Path,
) -> Result<PluginManifest, PluginFailure> {
    let request = json!({
        "palamedesBinaryPluginProtocol": PROTOCOL_VERSION,
        "hostVersion": env!("CARGO_PKG_VERSION"),
        "kind": "describe",
    });
    let invocation = invoke_binary(
        resolved,
        &request,
        cwd,
        native_executable,
        None,
        InvocationPolicy::describe(),
    )?;
    let manifest = manifest_from_invocation(resolved, invocation)?;
    validate_manifest(resolved, &manifest)?;
    Ok(manifest)
}

fn plugin_manifest_cache_path(config: &LoadedConfig) -> PathBuf {
    config.root_dir.join(".palamedes/plugin-manifests.json")
}

fn load_plugin_manifest_cache(config: &LoadedConfig) -> PluginManifestCache {
    let fresh = PluginManifestCache::fresh();
    let Ok(raw) = fs::read(plugin_manifest_cache_path(config)) else {
        return fresh;
    };
    let Ok(cache) = serde_json::from_slice::<PluginManifestCache>(&raw) else {
        return fresh;
    };
    if cache.schema != PLUGIN_MANIFEST_CACHE_SCHEMA
        || cache.protocol_version != PROTOCOL_VERSION
        || cache.host_version != env!("CARGO_PKG_VERSION")
    {
        return fresh;
    }
    cache
}

fn save_plugin_manifest_cache(config: &LoadedConfig, cache: &PluginManifestCache) {
    let path = plugin_manifest_cache_path(config);
    let Some(parent) = path.parent() else {
        return;
    };
    let Ok(raw) = serde_json::to_vec(cache) else {
        return;
    };
    // This cache is an optional startup optimization. A read-only checkout or
    // failed publication must never stop the requested plugin command; the next
    // invocation simply performs the describe handshake again.
    if fs::create_dir_all(parent).is_ok() {
        let _ = persist_plugin_manifest_cache(&path, &raw);
    }
}

fn persist_plugin_manifest_cache(path: &Path, raw: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(raw)?;
    temporary.flush()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn plugin_cache_identity(resolved: &ResolvedPlugin) -> Option<(String, PluginBinaryStamp)> {
    let binary_path = fs::canonicalize(&resolved.binary_path).ok()?;
    let metadata = fs::metadata(&binary_path).ok()?;
    let modified_ns = u64::try_from(
        metadata
            .modified()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_nanos(),
    )
    .ok()?;
    Some((
        binary_path.to_string_lossy().into_owned(),
        PluginBinaryStamp {
            length: metadata.len(),
            modified_ns,
        },
    ))
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
            PluginEvent::Manifest { manifest } => Some(manifest),
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
    validate_manifest_with_reserved_namespaces(resolved, manifest, &reserved_plugin_namespaces())
}

fn validate_manifest_with_reserved_namespaces(
    resolved: &ResolvedPlugin,
    manifest: &PluginManifest,
    reserved_namespaces: &BTreeSet<String>,
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
    if reserved_namespaces.contains(&manifest.name) {
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
    streamed: bool,
) -> Result<PluginOutput, PluginFailure> {
    let mut diagnostics = Vec::new();
    let mut outputs = Vec::new();
    let mut result = None;

    for event in invocation.events {
        match event {
            PluginEvent::Manifest { .. } => {
                return Err(protocol_failure(
                    resolved,
                    "run must not emit a manifest event",
                ));
            }
            PluginEvent::Diagnostic { diagnostic } => diagnostics.push(diagnostic),
            PluginEvent::Output { text } => outputs.push(text),
            PluginEvent::Result { result: candidate } => {
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
            streamed,
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
        streamed,
    })
}

fn invoke_binary(
    resolved: &ResolvedPlugin,
    request: &Value,
    cwd: &Path,
    native_executable: &Path,
    mut stream_output: Option<&mut dyn FnMut(&str)>,
    policy: InvocationPolicy,
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
    let mut command = Command::new(&resolved.binary_path);
    command
        .current_dir(cwd)
        .env(NATIVE_EXECUTABLE_ENV, native_executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    isolate_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| {
        PluginFailure::new(
            "PLUGIN_BINARY_SPAWN_FAILED",
            format!(
                "Could not run binary plugin \"{}\" at {}: {error}",
                resolved.specifier,
                resolved.binary_path.display()
            ),
        )
    })?;
    #[cfg(unix)]
    let _signal_guard = ChildSignalGuard::arm(&child);

    // The request is written from a helper thread while this thread consumes
    // stdout, so a plugin that emits events before draining its stdin cannot
    // deadlock against a request larger than the pipe buffers.
    let stdin = child.stdin.take();
    let writer = thread::spawn(move || -> io::Result<()> {
        let Some(mut stdin) = stdin else {
            return Ok(());
        };
        match stdin.write_all(&request_bytes) {
            // A plugin may terminate before consuming its request. Preserve its
            // real exit status and protocol output instead of replacing those
            // with the resulting closed-pipe error.
            Err(error) if error.kind() != io::ErrorKind::BrokenPipe => Err(error),
            _ => Ok(()),
        }
    });

    let mut stdout = BufReader::new(child.stdout.take().expect("piped plugin stdout"));
    let (stdout_tx, stdout_rx) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || loop {
        let mut line = Vec::new();
        let read = Read::take(&mut stdout, (policy.max_line_bytes + 1) as u64)
            .read_until(b'\n', &mut line);
        let message = match read {
            Ok(0) => StdoutMessage::Eof,
            Ok(_) if line.len() > policy.max_line_bytes => StdoutMessage::LineTooLong,
            Ok(_) => StdoutMessage::Line(line),
            Err(error) => StdoutMessage::ReadFailed(error),
        };
        let finished = !matches!(message, StdoutMessage::Line(_));
        if stdout_tx.send(message).is_err() || finished {
            break;
        }
    });

    let mut events = Vec::new();
    let mut failure = None;
    let mut total_bytes = 0usize;
    let mut event_count = 0usize;
    let started = Instant::now();
    loop {
        let message = match policy.deadline {
            Some(deadline) => {
                let Some(remaining) = deadline.checked_sub(started.elapsed()) else {
                    failure = Some(timeout_failure(resolved, policy));
                    break;
                };
                match stdout_rx.recv_timeout(remaining) {
                    Ok(message) => message,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        failure = Some(timeout_failure(resolved, policy));
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        failure = Some(reader_failure(resolved));
                        break;
                    }
                }
            }
            None => match stdout_rx.recv() {
                Ok(message) => message,
                Err(_) => {
                    failure = Some(reader_failure(resolved));
                    break;
                }
            },
        };
        let line = match message {
            StdoutMessage::Line(line) => line,
            StdoutMessage::Eof => break,
            StdoutMessage::LineTooLong => {
                failure = Some(limit_failure(
                    resolved,
                    format!(
                        "one stdout line exceeded the {}-byte limit",
                        policy.max_line_bytes
                    ),
                ));
                break;
            }
            StdoutMessage::ReadFailed(error) => {
                failure = Some(PluginFailure::new(
                    "PLUGIN_BINARY_PROTOCOL",
                    format!(
                        "Could not read binary plugin \"{}\" output: {error}",
                        resolved.specifier
                    ),
                ));
                break;
            }
        };
        total_bytes = total_bytes.saturating_add(line.len());
        if total_bytes > policy.max_total_bytes {
            failure = Some(limit_failure(
                resolved,
                format!(
                    "stdout exceeded the {}-byte total limit",
                    policy.max_total_bytes
                ),
            ));
            break;
        }
        let Ok(line) = String::from_utf8(line) else {
            failure = Some(protocol_failure(resolved, "stdout was not valid UTF-8"));
            break;
        };
        let line = line.trim_end_matches(['\r', '\n']);
        if line.trim().is_empty() {
            continue;
        }
        event_count += 1;
        if event_count > policy.max_events {
            failure = Some(limit_failure(
                resolved,
                format!("stdout exceeded the {}-event limit", policy.max_events),
            ));
            break;
        }
        match parse_event_line(line, resolved) {
            Ok(PluginEvent::Output { text }) if stream_output.is_some() => {
                if let Some(stream) = stream_output.as_mut() {
                    stream(&text);
                }
            }
            Ok(event) => events.push(event),
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
    }
    if failure.is_some() {
        terminate_plugin_tree(&mut child);
    }

    let status = child.wait().map_err(|error| {
        PluginFailure::new(
            "PLUGIN_BINARY_SPAWN_FAILED",
            format!(
                "Could not wait for binary plugin \"{}\": {error}",
                resolved.specifier
            ),
        )
    })?;
    drop(stdout_rx);
    if reader.join().is_err() && failure.is_none() {
        failure = Some(reader_failure(resolved));
    }
    if let Some(failure) = failure {
        let _ = writer.join();
        return Err(failure);
    }
    match writer.join() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            return Err(PluginFailure::new(
                "PLUGIN_BINARY_PROTOCOL",
                format!(
                    "Could not write a request to binary plugin \"{}\": {error}",
                    resolved.specifier
                ),
            ));
        }
        Err(_) => {
            return Err(PluginFailure::new(
                "PLUGIN_HOST_FAILED",
                format!(
                    "The request writer for binary plugin \"{}\" panicked.",
                    resolved.specifier
                ),
            ));
        }
    }

    Ok(BinaryInvocation {
        exit_code: exit_code(status),
        events,
    })
}

fn timeout_failure(resolved: &ResolvedPlugin, policy: InvocationPolicy) -> PluginFailure {
    let milliseconds = policy
        .deadline
        .expect("timeout failures require a deadline")
        .as_millis();
    PluginFailure::new(
        "PLUGIN_BINARY_TIMEOUT",
        format!(
            "Binary plugin \"{}\" exceeded the {milliseconds} ms {} deadline.",
            resolved.specifier, policy.request_kind
        ),
    )
}

fn limit_failure(resolved: &ResolvedPlugin, detail: impl AsRef<str>) -> PluginFailure {
    PluginFailure::new(
        "PLUGIN_BINARY_PROTOCOL_LIMIT",
        format!(
            "Binary plugin \"{}\" exceeded a protocol resource limit: {}.",
            resolved.specifier,
            detail.as_ref()
        ),
    )
}

fn reader_failure(resolved: &ResolvedPlugin) -> PluginFailure {
    PluginFailure::new(
        "PLUGIN_HOST_FAILED",
        format!(
            "The stdout reader for binary plugin \"{}\" stopped unexpectedly.",
            resolved.specifier
        ),
    )
}

#[cfg(unix)]
fn terminate_plugin_tree(child: &mut Child) {
    let Ok(group) = i32::try_from(child.id()) else {
        let _ = child.kill();
        return;
    };
    // SAFETY: the plugin was spawned as the leader of an isolated process
    // group, so a negative PID terminates it and every descendant in the group.
    if unsafe { libc::kill(-group, libc::SIGKILL) } != 0 {
        let _ = child.kill();
    }
}

#[cfg(windows)]
fn terminate_plugin_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn terminate_plugin_tree(child: &mut Child) {
    let _ = child.kill();
}

#[derive(Clone, Copy, Debug)]
struct InvocationPolicy {
    deadline: Option<Duration>,
    request_kind: &'static str,
    max_line_bytes: usize,
    max_total_bytes: usize,
    max_events: usize,
}

impl InvocationPolicy {
    const fn describe() -> Self {
        Self::new(Some(DESCRIBE_TIMEOUT), "describe")
    }

    const fn run(deadline: Option<Duration>) -> Self {
        Self::new(deadline, "run")
    }

    const fn new(deadline: Option<Duration>, request_kind: &'static str) -> Self {
        Self {
            deadline,
            request_kind,
            max_line_bytes: PROTOCOL_MAX_LINE_BYTES,
            max_total_bytes: PROTOCOL_MAX_TOTAL_BYTES,
            max_events: PROTOCOL_MAX_EVENTS,
        }
    }
}

enum StdoutMessage {
    Line(Vec<u8>),
    Eof,
    LineTooLong,
    ReadFailed(io::Error),
}

#[cfg(unix)]
fn isolate_process_group(command: &mut Command) {
    command.process_group(0);
}

#[cfg(not(unix))]
fn isolate_process_group(_command: &mut Command) {}

fn parse_event_line(line: &str, resolved: &ResolvedPlugin) -> Result<PluginEvent, PluginFailure> {
    let value: Value = serde_json::from_str(line)
        .map_err(|_| protocol_failure(resolved, format!("invalid JSON event line: {line}")))?;
    parse_event(value).map_err(|detail| protocol_failure(resolved, detail))
}

/// Forwards `SIGINT` and `SIGTERM` to the isolated plugin process group, so
/// direct and terminal signals reach the plugin tree exactly once.
#[cfg(unix)]
static ACTIVE_PLUGIN_GROUP: AtomicI32 = AtomicI32::new(0);

#[cfg(unix)]
struct ChildSignalGuard;

#[cfg(unix)]
impl ChildSignalGuard {
    fn arm(child: &std::process::Child) -> Self {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            let Ok(mut signals) = signal_hook::iterator::Signals::new([
                signal_hook::consts::SIGINT,
                signal_hook::consts::SIGTERM,
            ]) else {
                return;
            };
            thread::spawn(move || {
                for signal in signals.forever() {
                    let group = ACTIVE_PLUGIN_GROUP.load(Ordering::SeqCst);
                    if group > 0 {
                        // SAFETY: a negative PID addresses the isolated process
                        // group led by the currently running plugin child.
                        unsafe { libc::kill(-group, signal) };
                    } else {
                        // No child is running; restore the shell-compatible
                        // default outcome for the signal.
                        std::process::exit(128 + signal);
                    }
                }
            });
        });
        ACTIVE_PLUGIN_GROUP.store(
            i32::try_from(child.id()).unwrap_or_default(),
            Ordering::SeqCst,
        );
        Self
    }
}

#[cfg(unix)]
impl Drop for ChildSignalGuard {
    fn drop(&mut self) {
        ACTIVE_PLUGIN_GROUP.store(0, Ordering::SeqCst);
    }
}

fn parse_event(value: Value) -> Result<PluginEvent, String> {
    let kind = value
        .get("event")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "event lines must be objects with an \"event\" kind".to_owned())?;
    match kind.as_str() {
        "manifest" | "diagnostic" | "output" | "result" => {
            serde_json::from_value(value).map_err(|error| format!("invalid {kind} event: {error}"))
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
        Some("js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" | "mts" | "cts")
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
                    // The protocol documents these as real files, so they carry
                    // the storage extension the extraction pass writes.
                    "locales": config.locales.iter().map(|locale| json!({
                        "locale": locale,
                        "path": config
                            .resolve_catalog_path(&catalog.path, locale, catalog.format),
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

    if !output.streamed {
        for text in &output.outputs {
            println!("{text}");
        }
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

fn unknown_command_failure(namespace: &str) -> PluginFailure {
    let suggestion = nearest_builtin_command(namespace)
        .map(|name| format!(" Did you mean \"{name}\"?"))
        .unwrap_or_default();
    PluginFailure::with_exit_code(
        "COMMAND_UNKNOWN",
        format!(
            "Unknown command \"{namespace}\".{suggestion} No Palamedes config was found, so no configured binary plugin declares it either. Run \"pmds --help\" for the built-in commands."
        ),
        2,
    )
}

/// The closest built-in command name within two edits, if any. Clap owns this
/// for tokens it recognizes as near-misses of a subcommand, but an external
/// subcommand swallows every unknown token before Clap gets there.
fn nearest_builtin_command(namespace: &str) -> Option<String> {
    reserved_plugin_namespaces()
        .into_iter()
        .map(|name| (edit_distance(namespace, &name), name))
        .filter(|(distance, _)| *distance <= 2)
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, name)| name)
}

fn edit_distance(left: &str, right: &str) -> usize {
    let right: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0; right.len() + 1];
    for (row, left_character) in left.chars().enumerate() {
        current[0] = row + 1;
        for (column, right_character) in right.iter().enumerate() {
            let substitution = usize::from(left_character != *right_character);
            current[column + 1] = (previous[column] + substitution)
                .min(previous[column + 1] + 1)
                .min(current[column] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
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
    /// Absent for a bare namespace. Whether that is a missing command or an
    /// unknown one only becomes clear once the config has been consulted.
    command: Option<String>,
    command_args: Vec<String>,
    config_path: Option<PathBuf>,
    json: bool,
    plugin_timeout: Option<Duration>,
}

impl PluginInvocation {
    fn parse(args: &[String]) -> Result<Self, PluginFailure> {
        let namespace = args.first().cloned().ok_or_else(|| {
            PluginFailure::new("PLUGIN_ARGUMENT_INVALID", "Plugin namespace is required.")
        })?;
        let command = args.get(1).cloned();
        let mut command_args = Vec::new();
        let mut config_path = None;
        let mut json = false;
        let mut plugin_timeout = None;
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
            } else if value == "--plugin-timeout-ms" {
                let Some(next) = args.get(index + 1) else {
                    return Err(plugin_timeout_argument_failure());
                };
                plugin_timeout = Some(parse_plugin_timeout(next)?);
                index += 1;
            } else if let Some(milliseconds) = value.strip_prefix("--plugin-timeout-ms=") {
                plugin_timeout = Some(parse_plugin_timeout(milliseconds)?);
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
            plugin_timeout,
        })
    }
}

fn parse_plugin_timeout(value: &str) -> Result<Duration, PluginFailure> {
    let milliseconds = value
        .parse::<u64>()
        .ok()
        .filter(|milliseconds| *milliseconds > 0)
        .ok_or_else(plugin_timeout_argument_failure)?;
    Ok(Duration::from_millis(milliseconds))
}

fn plugin_timeout_argument_failure() -> PluginFailure {
    PluginFailure::new(
        "PLUGIN_ARGUMENT_INVALID",
        "--plugin-timeout-ms requires a positive integer number of milliseconds.",
    )
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
            command: invocation.command.clone(),
            json: invocation.json,
        }
    }
}

#[derive(Debug, Default)]
struct PluginRegistry {
    plugins: BTreeMap<String, LoadedPlugin>,
    skipped: Vec<SkippedPlugin>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifestCache {
    schema: u64,
    protocol_version: u64,
    host_version: String,
    entries: BTreeMap<String, CachedPluginManifest>,
}

impl PluginManifestCache {
    fn fresh() -> Self {
        Self {
            schema: PLUGIN_MANIFEST_CACHE_SCHEMA,
            protocol_version: PROTOCOL_VERSION,
            host_version: env!("CARGO_PKG_VERSION").to_owned(),
            entries: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedPluginManifest {
    stamp: PluginBinaryStamp,
    manifest: PluginManifest,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginBinaryStamp {
    length: u64,
    modified_ns: u64,
}

#[derive(Debug)]
struct SkippedPlugin {
    specifier: String,
    failure: PluginFailure,
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
struct PluginOutput {
    outputs: Vec<String>,
    text: Option<String>,
    data: Option<Value>,
    exit_code: u8,
    diagnostics: Vec<PluginDiagnostic>,
    /// Whether output events were already rendered while the plugin ran.
    streamed: bool,
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
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use clap::Command;
    use serde_json::json;

    use std::collections::{BTreeMap, BTreeSet};

    use super::{
        command_namespace_tokens, finish_run, is_kebab_name, matches_constraint, parse_event,
        persist_plugin_manifest_cache, plugin_catalogs, reserved_plugin_namespaces,
        resolve_binary_plugin, validate_manifest, validate_manifest_with_reserved_namespaces,
        BinaryInvocation, InvocationPolicy, PluginEvent, PluginInvocation, PluginManifest,
        ResolvedPlugin, PROTOCOL_VERSION,
    };
    use crate::config::load_config;
    use palamedes_plugin::ManifestCommand;

    #[test]
    fn reserved_plugin_namespaces_match_the_built_clap_command_tree() {
        assert_eq!(
            reserved_plugin_namespaces(),
            BTreeSet::from_iter(
                ["extract", "lint", "audit", "report", "catalog", "version", "help"]
                    .map(str::to_owned)
            )
        );
    }

    #[test]
    fn reserved_plugin_namespaces_include_aliases_without_an_order_contract() {
        let expected = BTreeSet::from_iter(
            [
                "audit",
                "check",
                "help",
                "internal-check",
                "report",
                "summary",
            ]
            .map(str::to_owned),
        );
        let mut audit_first = Command::new("pmds")
            .subcommand(
                Command::new("audit")
                    .visible_alias("check")
                    .alias("internal-check"),
            )
            .subcommand(Command::new("report").visible_alias("summary"));
        let mut report_first = Command::new("pmds")
            .subcommand(Command::new("report").visible_alias("summary"))
            .subcommand(
                Command::new("audit")
                    .visible_alias("check")
                    .alias("internal-check"),
            );

        assert_eq!(command_namespace_tokens(&mut audit_first), expected);
        assert_eq!(command_namespace_tokens(&mut report_first), expected);

        let resolved = ResolvedPlugin {
            specifier: "@acme/plugin".to_owned(),
            binary_path: "/fixture/plugin".into(),
        };
        for namespace in ["check", "internal-check", "summary"] {
            let manifest = PluginManifest {
                name: namespace.to_owned(),
                protocol_version: PROTOCOL_VERSION,
                commands: BTreeMap::from([(
                    "inspect".to_owned(),
                    ManifestCommand { description: None },
                )]),
            };
            assert_eq!(
                validate_manifest_with_reserved_namespaces(&resolved, &manifest, &expected)
                    .expect_err("alias collision rejected")
                    .code,
                "PLUGIN_NAMESPACE_COLLISION",
                "for alias {namespace}"
            );
        }
    }

    #[test]
    fn parses_reserved_plugin_options_and_passthrough() {
        let invocation = PluginInvocation::parse(&[
            "acme".to_owned(),
            "inspect".to_owned(),
            "--json".to_owned(),
            "--plugin-timeout-ms=250".to_owned(),
            "--config=palamedes.yaml".to_owned(),
            "first".to_owned(),
            "--".to_owned(),
            "--json".to_owned(),
        ])
        .expect("invocation");

        assert_eq!(invocation.namespace, "acme");
        assert_eq!(invocation.command.as_deref(), Some("inspect"));
        assert_eq!(invocation.command_args, ["first", "--json"]);
        assert_eq!(
            invocation.config_path.as_deref(),
            Some(Path::new("palamedes.yaml"))
        );
        assert!(invocation.json);
        assert_eq!(invocation.plugin_timeout, Some(Duration::from_millis(250)));
    }

    #[test]
    fn rejects_invalid_plugin_command_deadlines() {
        for value in ["0", "later", ""] {
            let error = PluginInvocation::parse(&[
                "acme".to_owned(),
                "inspect".to_owned(),
                format!("--plugin-timeout-ms={value}"),
            ])
            .expect_err("invalid timeout rejected");
            assert_eq!(error.code, "PLUGIN_ARGUMENT_INVALID");
        }
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
        let PluginEvent::Result { result } = event else {
            panic!("expected result event");
        };
        assert_eq!(result.text.as_deref(), Some("done"));
        assert_eq!(result.data, Some(json!(null)));
        assert_eq!(result.exit_code, Some(9));
    }

    #[test]
    fn parses_shared_manifest_with_a_missing_command_description() {
        let event = parse_event(json!({
            "event": "manifest",
            "name": "acme",
            "protocolVersion": PROTOCOL_VERSION,
            "commands": { "inspect": {} },
        }))
        .expect("manifest event");
        let PluginEvent::Manifest { manifest } = event else {
            panic!("expected manifest event");
        };
        assert_eq!(manifest.name, "acme");
        assert_eq!(
            manifest.commands["inspect"].description, None,
            "the shared wire type retains host-side manifest leniency"
        );
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
            false,
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
        let config = root.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");

        for name in [
            "plugin.mjs",
            "plugin.cjs",
            "plugin.mts",
            "plugin.cts",
            "plugin.tsx",
        ] {
            fs::write(root.join(name), "export {};").expect("script fixture");
            let error =
                resolve_binary_plugin(&format!("./{name}"), &config).expect_err("script rejected");
            assert_eq!(error.code, "PLUGIN_BINARY_REQUIRED", "for {name}");
        }
    }

    #[test]
    fn validates_manifest_protocol_names_and_built_in_collisions() {
        let resolved = ResolvedPlugin {
            specifier: "@acme/plugin".to_owned(),
            binary_path: "/fixture/plugin".into(),
        };
        let manifest = |name: &str, protocol_version: u64| PluginManifest {
            name: name.to_owned(),
            protocol_version,
            commands: BTreeMap::from([(
                "inspect".to_owned(),
                ManifestCommand { description: None },
            )]),
        };

        assert!(validate_manifest(&resolved, &manifest("acme", PROTOCOL_VERSION)).is_ok());
        assert_eq!(
            validate_manifest(&resolved, &manifest("acme", PROTOCOL_VERSION + 1))
                .expect_err("foreign protocol rejected")
                .code,
            "PLUGIN_PROTOCOL_INCOMPATIBLE"
        );
        assert_eq!(
            validate_manifest(&resolved, &manifest("Acme", PROTOCOL_VERSION))
                .expect_err("non-kebab namespace rejected")
                .code,
            "PLUGIN_INVALID"
        );
        for namespace in reserved_plugin_namespaces() {
            assert_eq!(
                validate_manifest(&resolved, &manifest(&namespace, PROTOCOL_VERSION))
                    .expect_err("built-in collision rejected")
                    .code,
                "PLUGIN_NAMESPACE_COLLISION",
                "for built-in namespace {namespace}",
            );
        }

        let mut invalid_command = manifest("acme", PROTOCOL_VERSION);
        invalid_command
            .commands
            .insert("Bad".to_owned(), ManifestCommand { description: None });
        assert_eq!(
            validate_manifest(&resolved, &invalid_command)
                .expect_err("invalid command rejected")
                .code,
            "PLUGIN_INVALID"
        );
    }

    #[cfg(unix)]
    #[test]
    fn streams_output_events_while_the_plugin_runs() {
        use std::os::unix::fs::PermissionsExt;
        use std::path::Path;

        use super::invoke_binary;

        let root = temp_dir("streaming-plugin");
        let script = root.join("plugin");
        fs::write(
            &script,
            "#!/bin/sh\nread _request\n\
             printf '{\"event\":\"output\",\"text\":\"one\"}\\n'\n\
             printf '{\"event\":\"output\",\"text\":\"two\"}\\n'\n\
             printf '{\"event\":\"result\",\"text\":\"done\",\"exitCode\":0}\\n'\n",
        )
        .expect("plugin script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            binary_path: script,
        };

        let mut streamed = Vec::new();
        let mut capture = |text: &str| streamed.push(text.to_owned());
        let invocation = invoke_binary(
            &resolved,
            &json!({ "palamedesBinaryPluginProtocol": 1, "kind": "run" }),
            &root,
            Path::new("pmds"),
            Some(&mut capture),
            InvocationPolicy::run(None),
        )
        .expect("invocation");

        assert_eq!(streamed, ["one", "two"]);
        assert_eq!(invocation.exit_code, 0);
        assert_eq!(invocation.events.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn times_out_a_non_terminating_describe() {
        use std::os::unix::fs::PermissionsExt;

        use super::invoke_binary;

        let root = temp_dir("describe-timeout");
        let script = root.join("plugin");
        fs::write(
            &script,
            "#!/bin/sh\nread _request\nwhile :; do sleep 30; done\n",
        )
        .expect("plugin script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            binary_path: script,
        };

        let policy = InvocationPolicy::new(Some(Duration::from_millis(500)), "describe");
        let error = invoke_binary(
            &resolved,
            &json!({ "palamedesBinaryPluginProtocol": 1, "kind": "describe" }),
            &root,
            Path::new("pmds"),
            None,
            policy,
        )
        .expect_err("describe deadline enforced");

        assert_eq!(error.code, "PLUGIN_BINARY_TIMEOUT");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_plugin_stdout_over_the_total_byte_budget() {
        use std::os::unix::fs::PermissionsExt;

        use super::invoke_binary;

        let root = temp_dir("stdout-budget");
        let script = root.join("plugin");
        fs::write(
            &script,
            "#!/bin/sh\nread _request\n\
             printf '{\"event\":\"output\",\"text\":\"this is deliberately too large\"}\\n'\n",
        )
        .expect("plugin script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            binary_path: script,
        };
        let mut policy = InvocationPolicy::run(None);
        policy.max_total_bytes = 32;

        let error = invoke_binary(
            &resolved,
            &json!({ "palamedesBinaryPluginProtocol": 1, "kind": "run" }),
            &root,
            Path::new("pmds"),
            None,
            policy,
        )
        .expect_err("stdout budget enforced");

        assert_eq!(error.code, "PLUGIN_BINARY_PROTOCOL_LIMIT");
        assert!(error.message.contains("32-byte total limit"));
    }

    #[cfg(unix)]
    #[test]
    fn runs_plugins_in_an_isolated_process_group() {
        use std::process::{Command, Stdio};

        use super::{isolate_process_group, terminate_plugin_tree};

        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "while :; do sleep 1; done"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_process_group(&mut command);
        let mut child = command.spawn().expect("isolated child");
        let child_id = i32::try_from(child.id()).expect("child PID");

        // SAFETY: queries the process group of the child we just spawned.
        let child_group = unsafe { libc::getpgid(child_id) };
        terminate_plugin_tree(&mut child);
        child.wait().expect("isolated child exit");
        assert_eq!(child_group, child_id);
        // SAFETY: signal 0 only checks whether the terminated fixture group exists.
        assert_ne!(unsafe { libc::kill(-child_group, 0) }, 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_broken_plugin_blocks_only_its_own_namespace() {
        use std::os::unix::fs::PermissionsExt;
        use std::path::Path;

        use super::load_registry;
        use crate::config::load_config;

        let root = temp_dir("degraded-registry");
        let good = root.join("good");
        fs::create_dir_all(&good).expect("plugin directory");
        fs::write(
            good.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./describe"}}"#,
        )
        .expect("plugin manifest");
        let script = good.join("describe");
        fs::write(
            &script,
            "#!/bin/sh\nread _request\n\
             printf '{\"event\":\"manifest\",\"name\":\"good\",\"protocolVersion\":1,\
             \"commands\":{\"inspect\":{\"description\":\"d\"}}}\\n'\n",
        )
        .expect("describe script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        fs::write(
            root.join("palamedes.yaml"),
            r"
locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/messages
    include: [src]
plugins:
  - './good'
  - './missing'
",
        )
        .expect("config");

        let config = load_config(&root, None).expect("config with plugins");
        let registry = load_registry(&config, &root, Path::new("pmds")).expect("degraded registry");

        assert!(registry.plugins.contains_key("good"));
        assert_eq!(registry.skipped.len(), 1);
        assert_eq!(registry.skipped[0].specifier, "./missing");
        assert_eq!(registry.skipped[0].failure.code, "PLUGIN_MISSING");
    }

    #[cfg(unix)]
    #[test]
    fn caches_plugin_manifests_and_redescribes_only_changed_binaries() {
        use std::os::unix::fs::PermissionsExt;

        use super::{load_registry, plugin_manifest_cache_path};

        let root = temp_dir("manifest-cache");
        for namespace in ["alpha", "beta"] {
            let plugin = root.join(namespace);
            fs::create_dir_all(&plugin).expect("plugin directory");
            fs::write(
                plugin.join("package.json"),
                r#"{"palamedes":{"pluginBinary":"./describe"}}"#,
            )
            .expect("plugin manifest");
            let script = plugin.join("describe");
            fs::write(
                &script,
                format!(
                    "#!/bin/sh\nread _request\nprintf x >> \"$(dirname \"$0\")/counter\"\n\
                     printf '{{\"event\":\"manifest\",\"name\":\"{namespace}\",\
                     \"protocolVersion\":1,\"commands\":{{\"inspect\":{{}}}}}}\\n'\n"
                ),
            )
            .expect("describe script");
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        }
        fs::write(
            root.join("palamedes.yaml"),
            r"
locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/messages
    include: [src]
plugins:
  - './alpha'
  - './beta'
",
        )
        .expect("config");
        let config = load_config(&root, None).expect("config with plugins");

        let first = load_registry(&config, &root, Path::new("pmds")).expect("initial registry");
        assert_eq!(first.plugins.len(), 2);
        assert_eq!(fs::read_to_string(root.join("alpha/counter")).unwrap(), "x");
        assert_eq!(fs::read_to_string(root.join("beta/counter")).unwrap(), "x");
        assert!(plugin_manifest_cache_path(&config).is_file());

        let warm = load_registry(&config, &root, Path::new("pmds")).expect("cached registry");
        assert_eq!(warm.plugins.len(), 2);
        assert_eq!(fs::read_to_string(root.join("alpha/counter")).unwrap(), "x");
        assert_eq!(fs::read_to_string(root.join("beta/counter")).unwrap(), "x");

        let alpha_script = root.join("alpha/describe");
        let mut changed = fs::read_to_string(&alpha_script).expect("alpha script");
        changed.push('\n');
        fs::write(&alpha_script, changed).expect("change alpha binary identity");
        let refreshed =
            load_registry(&config, &root, Path::new("pmds")).expect("refreshed registry");
        assert_eq!(refreshed.plugins.len(), 2);
        assert_eq!(
            fs::read_to_string(root.join("alpha/counter")).unwrap(),
            "xx"
        );
        assert_eq!(fs::read_to_string(root.join("beta/counter")).unwrap(), "x");
    }

    #[cfg(unix)]
    #[test]
    fn cached_manifests_still_enforce_namespace_collisions() {
        use std::os::unix::fs::PermissionsExt;

        use super::load_registry;

        let root = temp_dir("cached-collision");
        for plugin_name in ["first", "second"] {
            let plugin = root.join(plugin_name);
            fs::create_dir_all(&plugin).expect("plugin directory");
            fs::write(
                plugin.join("package.json"),
                r#"{"palamedes":{"pluginBinary":"./describe"}}"#,
            )
            .expect("plugin manifest");
            let script = plugin.join("describe");
            fs::write(
                &script,
                "#!/bin/sh\nread _request\nprintf x >> \"$(dirname \"$0\")/counter\"\n\
                 printf '{\"event\":\"manifest\",\"name\":\"shared\",\
                 \"protocolVersion\":1,\"commands\":{\"inspect\":{}}}\\n'\n",
            )
            .expect("describe script");
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        }
        fs::write(
            root.join("palamedes.yaml"),
            r"
locales: [en]
source-locale: en
catalogs:
  - path: locales/{locale}/messages
    include: [src]
plugins:
  - './first'
  - './second'
",
        )
        .expect("config");
        let config = load_config(&root, None).expect("config with plugins");

        for attempt in 1..=2 {
            let error = load_registry(&config, &root, Path::new("pmds"))
                .expect_err("duplicate namespace rejected");
            assert_eq!(error.code, "PLUGIN_NAMESPACE_COLLISION");
            assert_eq!(
                fs::read_to_string(root.join("first/counter")).unwrap(),
                "x",
                "first binary describe count after attempt {attempt}"
            );
            assert_eq!(
                fs::read_to_string(root.join("second/counter")).unwrap(),
                "x",
                "second binary describe count after attempt {attempt}"
            );
        }
    }

    /*
     * The protocol documents catalogs[].locales[].path as the catalog file, so
     * a plugin has to be able to open it. Without the storage extension every
     * such open is an ENOENT the plugin author has to work around.
     */
    #[test]
    fn per_locale_catalog_paths_carry_the_storage_extension() {
        let root = temp_dir("plugin-catalog-paths");
        let config_path = root.join("palamedes.yaml");
        fs::write(
            &config_path,
            r#"locales: [en, de]
source-locale: en
catalogs:
  - path: locales/{locale}/messages
    include: [src]
  - path: locales/{locale}/lines
    format: fcl
    include: [src]
  - path: locales/{locale}/messages.v2
    include: [src]
"#,
        )
        .expect("write config");
        let config = load_config(&root, Some(&config_path)).expect("load config");

        let catalogs = plugin_catalogs(&config);

        assert_eq!(
            catalogs[0]["locales"][1]["path"],
            json!(root.join("locales/de/messages.po")),
        );
        assert_eq!(
            catalogs[1]["locales"][0]["path"],
            json!(root.join("locales/en/lines.fcl")),
        );
        assert_eq!(catalogs[0]["path"], json!("locales/{locale}/messages"));
        assert_eq!(
            catalogs[2]["locales"][0]["path"],
            json!(root.join("locales/en/messages.v2.po")),
        );
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

    #[test]
    fn publishes_plugin_manifest_cache_without_leaving_partial_files() {
        let root = temp_dir("atomic-manifest-cache");
        let cache_dir = root.join(".palamedes");
        fs::create_dir_all(&cache_dir).expect("cache directory");
        let cache_path = cache_dir.join("plugin-manifests.json");
        fs::write(&cache_path, br#"{"generation":"old"}"#).expect("seed cache");

        let replacement = br#"{"generation":"new","entries":{"plugin":{}}}"#;
        persist_plugin_manifest_cache(&cache_path, replacement).expect("publish cache");

        assert_eq!(fs::read(&cache_path).expect("read cache"), replacement);
        assert_eq!(
            fs::read_dir(&cache_dir)
                .expect("read cache directory")
                .map(|entry| entry.expect("cache entry").file_name())
                .collect::<Vec<_>>(),
            [std::ffi::OsString::from("plugin-manifests.json")]
        );
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
