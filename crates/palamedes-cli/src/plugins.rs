//! Native dispatch for explicit binary plugin commands.
//!
//! Built-ins stay in the Clap command tree and reach this module only for an
//! external namespace. Binary plugins are resolved from the data config,
//! described over the versioned stdio protocol, and then run as child
//! processes. No JavaScript module or executable config is loaded here.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, BufReader, IsTerminal, Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
#[cfg(unix)]
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Once};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};

use clap::CommandFactory;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use palamedes_plugin::{Event as PluginEvent, PluginDiagnostic, PluginManifest, Severity};
use serde::{Deserialize, Serialize};

use crate::command::{Context, VersionedJson};
use crate::config::{ConfigError, LoadedConfig};
use crate::error::CliError;
use crate::plugin_protocol::{parse_event, read_protocol_line};

const PROTOCOL_VERSION: u64 = palamedes_plugin::PROTOCOL_VERSION;
const NATIVE_EXECUTABLE_ENV: &str = palamedes_plugin::NATIVE_EXECUTABLE_ENV;
const PLUGIN_PATH_ENV: &str = palamedes_plugin::PLUGIN_PATH_ENV;
const PLUGIN_DIR_ENV: &str = palamedes_plugin::PLUGIN_DIR_ENV;
const PLUGIN_MANIFEST_CACHE_SCHEMA: u64 = 3;
const DESCRIBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROTOCOL_MAX_LINE_BYTES: usize = 1024 * 1024;
const PROTOCOL_MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;
const PROTOCOL_MAX_EVENTS: usize = 10_000;
const CHILD_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(10);
#[cfg(unix)]
const PLUGIN_SPAWN_ATTEMPTS: usize = 6;
#[cfg(unix)]
const PLUGIN_SPAWN_RETRY_INTERVAL: Duration = Duration::from_millis(10);
#[cfg(unix)]
const TEXT_FILE_BUSY_OS_ERROR: i32 = 26;
static PLUGIN_MANIFEST_CACHE_WARNING: Once = Once::new();

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
            return Err(unknown_command_failure(&invocation.namespace));
        }
        Err(error) => {
            return Err(PluginFailure::new(
                "PLUGIN_CONFIG_FAILED",
                error.to_string(),
            ));
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
    let registry = load_registry(
        &config,
        &cwd,
        &native_executable,
        !invocation.refresh_plugin_manifests,
    )?;
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
    reuse_cached_manifests: bool,
) -> Result<PluginRegistry, PluginFailure> {
    load_registry_with_binary_hasher(
        config,
        cwd,
        native_executable,
        reuse_cached_manifests,
        &hash_plugin_binary,
    )
}

fn load_registry_with_binary_hasher(
    config: &LoadedConfig,
    cwd: &Path,
    native_executable: &Path,
    reuse_cached_manifests: bool,
    hash_binary: &dyn Fn(&Path) -> Option<[u8; 32]>,
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
        let binary_path = fs::canonicalize(&resolved.binary_path).ok();
        let cached_stamp = if reuse_cached_manifests {
            binary_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned())
                .and_then(|key| cache.entries.get(&key))
                .map(|entry| &entry.stamp)
        } else {
            None
        };
        let cache_identity = binary_path.as_deref().and_then(|binary_path| {
            plugin_cache_identity_for_resolved(&resolved, binary_path, cached_stamp, hash_binary)
        });
        let manifest = match cache_identity.as_ref().and_then(|(key, stamp)| {
            active_cache_keys.insert(key.clone());
            if !reuse_cached_manifests {
                return None;
            }
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
                    if let Some((key, stamp)) = cache_identity
                        && binary_path
                            .as_deref()
                            .is_some_and(|path| resolved.pinned_matches_path(path, &stamp.metadata))
                    {
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
    if cache_dirty && let Err(error) = save_plugin_manifest_cache(config, &cache) {
        report_plugin_manifest_cache_failure(config, &error);
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

fn save_plugin_manifest_cache(
    config: &LoadedConfig,
    cache: &PluginManifestCache,
) -> io::Result<()> {
    let path = plugin_manifest_cache_path(config);
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "plugin manifest cache path has no parent directory",
        )
    })?;
    let raw = serde_json::to_vec(cache).map_err(io::Error::other)?;
    // This cache is an optional startup optimization. A read-only checkout or
    // failed publication must never stop the requested plugin command; the next
    // invocation simply performs the describe handshake again.
    fs::create_dir_all(parent)?;
    persist_plugin_manifest_cache(&path, &raw)
}

fn report_plugin_manifest_cache_failure(config: &LoadedConfig, error: &io::Error) {
    let mut stderr = io::stderr().lock();
    write_plugin_manifest_cache_warning_once(
        &PLUGIN_MANIFEST_CACHE_WARNING,
        &plugin_manifest_cache_path(config),
        error,
        &mut stderr,
    );
}

fn write_plugin_manifest_cache_warning_once(
    warning: &Once,
    path: &Path,
    error: &io::Error,
    output: &mut dyn Write,
) {
    warning.call_once(|| {
        let _ = writeln!(
            output,
            "Warning: could not write the plugin manifest cache to {}: {error}",
            path.display()
        );
    });
}

fn persist_plugin_manifest_cache(path: &Path, raw: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(raw)?;
    temporary.flush()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn plugin_cache_identity_for_resolved(
    resolved: &ResolvedPlugin,
    binary_path: &Path,
    cached: Option<&PluginBinaryStamp>,
    hash_binary: &dyn Fn(&Path) -> Option<[u8; 32]>,
) -> Option<(String, PluginBinaryStamp)> {
    let metadata = fs::metadata(binary_path).ok()?;
    let binary_metadata = plugin_binary_metadata(&metadata);
    if !resolved.pinned_matches_path(binary_path, &binary_metadata) {
        return None;
    }
    let identity = plugin_cache_identity(binary_path, cached, hash_binary)?;
    if !resolved.pinned_matches_path(binary_path, &identity.1.metadata) {
        return None;
    }
    Some(identity)
}

fn plugin_cache_identity(
    binary_path: &Path,
    cached: Option<&PluginBinaryStamp>,
    hash_binary: &dyn Fn(&Path) -> Option<[u8; 32]>,
) -> Option<(String, PluginBinaryStamp)> {
    let metadata = fs::metadata(binary_path).ok()?;
    let binary_metadata = plugin_binary_metadata(&metadata);
    if let Some(cached) = cached
        && cached.metadata.permits_digest_reuse(&binary_metadata)
    {
        return Some((binary_path.to_string_lossy().into_owned(), cached.clone()));
    }
    let sha256 = hash_binary(binary_path)?;
    Some((
        binary_path.to_string_lossy().into_owned(),
        PluginBinaryStamp {
            metadata: binary_metadata,
            sha256,
        },
    ))
}

fn hash_plugin_binary(binary_path: &Path) -> Option<[u8; 32]> {
    let mut binary = fs::File::open(binary_path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes_read = binary.read(&mut buffer).ok()?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    Some(hasher.finalize().into())
}

fn plugin_binary_metadata(metadata: &fs::Metadata) -> PluginBinaryMetadata {
    let modified_ns = metadata.modified().ok().and_then(|modified| {
        u64::try_from(modified.duration_since(UNIX_EPOCH).ok()?.as_nanos()).ok()
    });
    PluginBinaryMetadata {
        length: metadata.len(),
        modified_ns,
        unix_identity: unix_plugin_binary_identity(metadata),
    }
}

#[cfg(unix)]
fn unix_plugin_binary_identity(metadata: &fs::Metadata) -> Option<UnixPluginBinaryIdentity> {
    use std::os::unix::fs::MetadataExt;

    unix_plugin_binary_identity_from_parts(
        metadata.dev(),
        metadata.ino(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
    )
}

#[cfg(unix)]
fn unix_plugin_binary_identity_from_parts(
    device: u64,
    inode: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
) -> Option<UnixPluginBinaryIdentity> {
    // A zero ctime nanosecond component can indicate a second-resolution
    // filesystem. Treat it as incomplete rather than trusting a coarse clock.
    if inode == 0
        || !(0..1_000_000_000).contains(&modified_nanoseconds)
        || !(1..1_000_000_000).contains(&changed_nanoseconds)
    {
        return None;
    }
    Some(UnixPluginBinaryIdentity {
        device,
        inode,
        modified_seconds,
        modified_nanoseconds,
        changed_seconds,
        changed_nanoseconds,
    })
}

#[cfg(not(unix))]
fn unix_plugin_binary_identity(_metadata: &fs::Metadata) -> Option<UnixPluginBinaryIdentity> {
    None
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
    let mut child = spawn_resolved_binary(resolved, cwd, native_executable).map_err(|error| {
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
    let stdin = child.take_stdin();
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

    let mut stdout = BufReader::new(child.take_stdout().expect("piped plugin stdout"));
    let (stdout_tx, stdout_rx) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || {
        loop {
            let (read, line) = read_protocol_line(&mut stdout, policy.max_line_bytes);
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
    let mut status = None;
    if failure.is_none() {
        match wait_for_plugin_exit(&mut child, resolved, policy, started) {
            Ok(exit_status) => status = Some(exit_status),
            Err(error) => failure = Some(error),
        }
    }
    if failure.is_some() {
        terminate_plugin_tree(&mut child);
        let _ = child.wait();
    }
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
        exit_code: exit_code(status.expect("successful plugin invocation has an exit status")),
        events,
    })
}

#[cfg(not(windows))]
type PluginStdin = ChildStdin;

#[cfg(not(windows))]
type PluginStdout = ChildStdout;

#[cfg(not(windows))]
struct PluginChild(Child);

#[cfg(not(windows))]
impl PluginChild {
    fn take_stdin(&mut self) -> Option<PluginStdin> {
        self.0.stdin.take()
    }

    fn take_stdout(&mut self) -> Option<PluginStdout> {
        self.0.stdout.take()
    }

    #[cfg(unix)]
    fn id(&self) -> u32 {
        self.0.id()
    }

    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.0.try_wait()
    }

    fn wait(&mut self) -> io::Result<ExitStatus> {
        self.0.wait()
    }

    fn kill(&mut self) -> io::Result<()> {
        self.0.kill()
    }
}

#[cfg(windows)]
enum PluginStdin {
    Std(ChildStdin),
    Pipe(fs::File),
}

#[cfg(windows)]
impl Write for PluginStdin {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Self::Std(stdin) => stdin.write(buf),
            Self::Pipe(file) => file.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Self::Std(stdin) => stdin.flush(),
            Self::Pipe(file) => file.flush(),
        }
    }
}

#[cfg(windows)]
enum PluginStdout {
    Std(ChildStdout),
    Pipe(fs::File),
}

#[cfg(windows)]
impl Read for PluginStdout {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Std(stdout) => stdout.read(buf),
            Self::Pipe(file) => file.read(buf),
        }
    }
}

#[cfg(windows)]
struct WindowsAliasChild {
    process: std::os::windows::io::OwnedHandle,
    pid: u32,
    stdin: Option<fs::File>,
    stdout: Option<fs::File>,
    exit_status: Option<ExitStatus>,
}

#[cfg(windows)]
enum PluginChild {
    Std(Child),
    WinAlias(WindowsAliasChild),
}

#[cfg(windows)]
impl PluginChild {
    fn take_stdin(&mut self) -> Option<PluginStdin> {
        match self {
            Self::Std(child) => child.stdin.take().map(PluginStdin::Std),
            Self::WinAlias(child) => child.stdin.take().map(PluginStdin::Pipe),
        }
    }

    fn take_stdout(&mut self) -> Option<PluginStdout> {
        match self {
            Self::Std(child) => child.stdout.take().map(PluginStdout::Std),
            Self::WinAlias(child) => child.stdout.take().map(PluginStdout::Pipe),
        }
    }

    fn id(&self) -> u32 {
        match self {
            Self::Std(child) => child.id(),
            Self::WinAlias(child) => child.pid,
        }
    }

    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        match self {
            Self::Std(child) => child.try_wait(),
            Self::WinAlias(child) => child.wait_with_timeout(0),
        }
    }

    fn wait(&mut self) -> io::Result<ExitStatus> {
        match self {
            Self::Std(child) => child.wait(),
            Self::WinAlias(child) => child
                .wait_with_timeout(windows_alias_spawn::INFINITE)?
                .ok_or_else(|| io::Error::other("Windows plugin wait returned without status")),
        }
    }

    fn kill(&mut self) -> io::Result<()> {
        match self {
            Self::Std(child) => child.kill(),
            Self::WinAlias(child) => child.kill(),
        }
    }
}

#[cfg(any(windows, test))]
fn encode_windows_argv0_command_line(invocation_units: &[u16]) -> io::Result<Vec<u16>> {
    if invocation_units.is_empty()
        || invocation_units
            .iter()
            .any(|&unit| unit == 0 || unit == u16::from(b'"'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid Windows plugin invocation path",
        ));
    }
    let mut command_line = Vec::with_capacity(invocation_units.len() + 3);
    command_line.push(u16::from(b'"'));
    command_line.extend_from_slice(invocation_units);
    command_line.push(u16::from(b'"'));
    command_line.push(0);
    Ok(command_line)
}

#[cfg(any(windows, test))]
fn build_windows_environment_block_units(
    entries: Vec<(Vec<u16>, Vec<u16>)>,
    overrides: &[(&str, &[u16])],
) -> io::Result<Vec<u16>> {
    let mut override_entries = Vec::with_capacity(overrides.len());
    for &(key, value) in overrides {
        if value.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Windows environment override contains interior NUL",
            ));
        }
        let key_units: Vec<u16> = key.encode_utf16().collect();
        let key_upper: Vec<u16> = key.to_ascii_uppercase().encode_utf16().collect();
        override_entries.push((key_upper, key_units, value.to_vec()));
    }
    let mut filtered = Vec::with_capacity(entries.len() + override_entries.len());
    for (key, value) in entries {
        if key.is_empty()
            || key.contains(&0)
            || key[1..].contains(&u16::from(b'='))
            || value.contains(&0)
        {
            continue;
        }
        let key_upper: Vec<u16> = key
            .iter()
            .map(|&unit| {
                u8::try_from(unit).map_or(unit, |byte| u16::from(byte.to_ascii_uppercase()))
            })
            .collect();
        if override_entries
            .iter()
            .any(|(override_upper, _, _)| *override_upper == key_upper)
        {
            continue;
        }
        filtered.push((key_upper, key, value));
    }
    filtered.extend(override_entries);
    filtered.sort_by(|left, right| left.0.cmp(&right.0));

    let mut block = Vec::new();
    for (_, key, value) in filtered {
        block.extend_from_slice(&key);
        block.push(u16::from(b'='));
        block.extend_from_slice(&value);
        block.push(0);
    }
    if block.is_empty() {
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

#[cfg(windows)]
mod windows_alias_spawn {
    use std::env;
    use std::ffi::{OsStr, c_void};
    use std::fs::File;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::os::windows::process::ExitStatusExt;
    use std::path::Path;
    use std::process::ExitStatus;

    use super::{
        WindowsAliasChild, build_windows_environment_block_units, encode_windows_argv0_command_line,
    };

    pub(super) const INFINITE: u32 = 0xFFFF_FFFF;
    const WAIT_OBJECT_0: u32 = 0x0000_0000;
    const WAIT_TIMEOUT: u32 = 0x0000_0102;
    const HANDLE_FLAG_INHERIT: u32 = 0x0000_0001;
    const STARTF_USESTDHANDLES: u32 = 0x0000_0100;
    const CREATE_UNICODE_ENVIRONMENT: u32 = 0x0000_0400;
    const EXTENDED_STARTUPINFO_PRESENT: u32 = 0x0008_0000;
    const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
    const STD_ERROR_HANDLE: u32 = 0xFFFF_FFF4;
    const DUPLICATE_SAME_ACCESS: u32 = 0x0000_0002;
    const INVALID_HANDLE_VALUE: *mut c_void = (-1_isize) as *mut c_void;

    #[repr(C)]
    struct SecurityAttributes {
        n_length: u32,
        lp_security_descriptor: *mut c_void,
        b_inherit_handle: i32,
    }

    #[repr(C)]
    struct StartupInfoW {
        cb: u32,
        lp_reserved: *mut u16,
        lp_desktop: *mut u16,
        lp_title: *mut u16,
        dw_x: u32,
        dw_y: u32,
        dw_x_size: u32,
        dw_y_size: u32,
        dw_x_count_chars: u32,
        dw_y_count_chars: u32,
        dw_fill_attribute: u32,
        dw_flags: u32,
        w_show_window: u16,
        cb_reserved2: u16,
        lp_reserved2: *mut u8,
        h_std_input: *mut c_void,
        h_std_output: *mut c_void,
        h_std_error: *mut c_void,
    }

    #[repr(C)]
    struct StartupInfoExW {
        startup_info: StartupInfoW,
        lp_attribute_list: *mut c_void,
    }

    #[repr(C)]
    struct ProcessInformation {
        h_process: *mut c_void,
        h_thread: *mut c_void,
        dw_process_id: u32,
        dw_thread_id: u32,
    }

    struct ProcThreadAttributeList {
        buffer: Vec<usize>,
        _handles: Vec<*mut c_void>,
    }

    impl ProcThreadAttributeList {
        fn new_handle_list(mut handles: Vec<*mut c_void>) -> io::Result<Self> {
            let mut required_bytes: usize = 0;
            // SAFETY: querying the required attribute list size with a null pointer.
            unsafe {
                let _ = InitializeProcThreadAttributeList(
                    std::ptr::null_mut(),
                    1,
                    0,
                    &mut required_bytes,
                );
            }
            if required_bytes == 0 {
                return Err(io::Error::last_os_error());
            }
            let word_len = required_bytes.div_ceil(std::mem::size_of::<usize>());
            let mut buffer = vec![0_usize; word_len];
            // SAFETY: `buffer` is aligned to `usize` and has at least `required_bytes` bytes.
            if unsafe {
                InitializeProcThreadAttributeList(
                    buffer.as_mut_ptr().cast::<c_void>(),
                    1,
                    0,
                    &mut required_bytes,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            let mut list = Self {
                buffer,
                _handles: Vec::new(),
            };
            let byte_len = handles.len() * std::mem::size_of::<*mut c_void>();
            // SAFETY: `list.buffer` is initialized and `handles` stays owned by
            // `list` until after `DeleteProcThreadAttributeList` runs in `Drop`.
            if unsafe {
                UpdateProcThreadAttribute(
                    list.as_mut_ptr(),
                    0,
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    handles.as_mut_ptr().cast::<c_void>(),
                    byte_len,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            list._handles = handles;
            Ok(list)
        }

        fn as_mut_ptr(&mut self) -> *mut c_void {
            self.buffer.as_mut_ptr().cast::<c_void>()
        }
    }

    impl Drop for ProcThreadAttributeList {
        fn drop(&mut self) {
            // SAFETY: `self.buffer` was successfully initialized by
            // `InitializeProcThreadAttributeList`.
            unsafe {
                DeleteProcThreadAttributeList(self.as_mut_ptr());
            }
        }
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn InitializeProcThreadAttributeList(
            lp_attribute_list: *mut c_void,
            dw_attribute_count: u32,
            dw_flags: u32,
            lp_size: *mut usize,
        ) -> i32;
        fn UpdateProcThreadAttribute(
            lp_attribute_list: *mut c_void,
            dw_flags: u32,
            attribute: usize,
            lp_value: *mut c_void,
            cb_size: usize,
            lp_previous_value: *mut c_void,
            lp_return_size: *mut usize,
        ) -> i32;
        fn DeleteProcThreadAttributeList(lp_attribute_list: *mut c_void);
        fn CreatePipe(
            h_read_pipe: *mut *mut c_void,
            h_write_pipe: *mut *mut c_void,
            lp_pipe_attributes: *mut SecurityAttributes,
            n_size: u32,
        ) -> i32;
        fn SetHandleInformation(h_object: *mut c_void, dw_mask: u32, dw_flags: u32) -> i32;
        fn GetStdHandle(n_std_handle: u32) -> *mut c_void;
        fn GetCurrentProcess() -> *mut c_void;
        fn DuplicateHandle(
            h_source_process_handle: *mut c_void,
            h_source_handle: *mut c_void,
            h_target_process_handle: *mut c_void,
            lp_target_handle: *mut *mut c_void,
            dw_desired_access: u32,
            b_inherit_handle: i32,
            dw_options: u32,
        ) -> i32;
        fn CreateProcessW(
            lp_application_name: *const u16,
            lp_command_line: *mut u16,
            lp_process_attributes: *mut SecurityAttributes,
            lp_thread_attributes: *mut SecurityAttributes,
            b_inherit_handles: i32,
            dw_creation_flags: u32,
            lp_environment: *const c_void,
            lp_current_directory: *const u16,
            lp_startup_info: *const StartupInfoW,
            lp_process_information: *mut ProcessInformation,
        ) -> i32;
        fn WaitForSingleObject(h_handle: *mut c_void, dw_milliseconds: u32) -> u32;
        fn GetExitCodeProcess(h_process: *mut c_void, lp_exit_code: *mut u32) -> i32;
        fn TerminateProcess(h_process: *mut c_void, u_exit_code: u32) -> i32;
    }

    fn to_wide_nul(value: &OsStr) -> io::Result<Vec<u16>> {
        let mut units: Vec<u16> = value.encode_wide().collect();
        if units.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Windows path contains interior NUL",
            ));
        }
        units.push(0);
        Ok(units)
    }

    fn create_inheritable_pipe() -> io::Result<(OwnedHandle, OwnedHandle)> {
        let mut attrs = SecurityAttributes {
            n_length: u32::try_from(std::mem::size_of::<SecurityAttributes>())
                .expect("SecurityAttributes fits in u32"),
            lp_security_descriptor: std::ptr::null_mut(),
            b_inherit_handle: 1,
        };
        let mut read_raw = std::ptr::null_mut();
        let mut write_raw = std::ptr::null_mut();
        // SAFETY: output pointers and `attrs` are valid for `CreatePipe`.
        if unsafe { CreatePipe(&mut read_raw, &mut write_raw, &mut attrs, 0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `CreatePipe` succeeded and returned two newly owned handles.
        let read_handle = unsafe { OwnedHandle::from_raw_handle(read_raw) };
        // SAFETY: `CreatePipe` succeeded and returned two newly owned handles.
        let write_handle = unsafe { OwnedHandle::from_raw_handle(write_raw) };
        Ok((read_handle, write_handle))
    }

    fn mark_not_inheritable(handle: &OwnedHandle) -> io::Result<()> {
        // SAFETY: `handle` is an open Windows kernel handle.
        if unsafe { SetHandleInformation(handle.as_raw_handle(), HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn duplicate_inheritable_stderr() -> io::Result<Option<OwnedHandle>> {
        // SAFETY: `GetStdHandle` has no preconditions.
        let raw = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            return Ok(None);
        }
        let mut dup = std::ptr::null_mut();
        // SAFETY: `GetCurrentProcess` returns the pseudo-handle for this process.
        let proc_handle = unsafe { GetCurrentProcess() };
        // SAFETY: `raw` is the current standard error handle and `dup` is writable.
        if unsafe {
            DuplicateHandle(
                proc_handle,
                raw,
                proc_handle,
                &mut dup,
                0,
                1,
                DUPLICATE_SAME_ACCESS,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `DuplicateHandle` succeeded and returned a newly owned handle.
        Ok(Some(unsafe { OwnedHandle::from_raw_handle(dup) }))
    }

    pub(super) fn spawn_alias_binary(
        binary_path: &Path,
        invocation_path: &Path,
        cwd: &Path,
        env_overrides: &[(&str, &OsStr)],
    ) -> io::Result<WindowsAliasChild> {
        let app_name = to_wide_nul(binary_path.as_os_str())?;
        let invocation_units: Vec<u16> = invocation_path.as_os_str().encode_wide().collect();
        let mut cmd_line = encode_windows_argv0_command_line(&invocation_units)?;
        let cwd_wide = to_wide_nul(cwd.as_os_str())?;
        let override_values: Vec<(&str, Vec<u16>)> = env_overrides
            .iter()
            .map(|&(key, value)| (key, value.encode_wide().collect()))
            .collect();
        let override_refs: Vec<(&str, &[u16])> = override_values
            .iter()
            .map(|(key, value)| (*key, value.as_slice()))
            .collect();
        let env_entries: Vec<(Vec<u16>, Vec<u16>)> = env::vars_os()
            .map(|(k, v)| (k.encode_wide().collect(), v.encode_wide().collect()))
            .collect();
        let env_block = build_windows_environment_block_units(env_entries, &override_refs)?;

        let (stdin_read, stdin_write) = create_inheritable_pipe()?;
        mark_not_inheritable(&stdin_write)?;
        let (stdout_read, stdout_write) = create_inheritable_pipe()?;
        mark_not_inheritable(&stdout_read)?;
        let stderr_dup = duplicate_inheritable_stderr()?;

        let mut inherited_handles = vec![stdin_read.as_raw_handle(), stdout_write.as_raw_handle()];
        if let Some(ref stderr) = stderr_dup {
            inherited_handles.push(stderr.as_raw_handle());
        }
        let mut attr_list = ProcThreadAttributeList::new_handle_list(inherited_handles)?;

        let startup_info = StartupInfoExW {
            startup_info: StartupInfoW {
                cb: u32::try_from(std::mem::size_of::<StartupInfoExW>())
                    .expect("StartupInfoExW fits in u32"),
                lp_reserved: std::ptr::null_mut(),
                lp_desktop: std::ptr::null_mut(),
                lp_title: std::ptr::null_mut(),
                dw_x: 0,
                dw_y: 0,
                dw_x_size: 0,
                dw_y_size: 0,
                dw_x_count_chars: 0,
                dw_y_count_chars: 0,
                dw_fill_attribute: 0,
                dw_flags: STARTF_USESTDHANDLES,
                w_show_window: 0,
                cb_reserved2: 0,
                lp_reserved2: std::ptr::null_mut(),
                h_std_input: stdin_read.as_raw_handle(),
                h_std_output: stdout_write.as_raw_handle(),
                h_std_error: stderr_dup
                    .as_ref()
                    .map_or(std::ptr::null_mut(), AsRawHandle::as_raw_handle),
            },
            lp_attribute_list: attr_list.as_mut_ptr(),
        };
        let mut proc_info = ProcessInformation {
            h_process: std::ptr::null_mut(),
            h_thread: std::ptr::null_mut(),
            dw_process_id: 0,
            dw_thread_id: 0,
        };

        // SAFETY: `app_name`, `cmd_line`, `env_block`, `cwd_wide`,
        // `startup_info` (with its `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` restricting
        // inheritance strictly to stdio), and `proc_info` remain valid for the
        // duration of `CreateProcessW`.
        let created = unsafe {
            CreateProcessW(
                app_name.as_ptr(),
                cmd_line.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
                env_block.as_ptr().cast::<c_void>(),
                cwd_wide.as_ptr(),
                &startup_info.startup_info,
                &mut proc_info,
            )
        };
        // Capture the Win32 error immediately before handle/attribute-list
        // cleanup can overwrite the thread's last-error value.
        let spawn_error = if created == 0 {
            Some(io::Error::last_os_error())
        } else {
            None
        };
        drop(attr_list);
        drop(stdin_read);
        drop(stdout_write);
        drop(stderr_dup);
        if let Some(error) = spawn_error {
            return Err(error);
        }
        // SAFETY: `CreateProcessW` succeeded and returned owned process and thread handles.
        let process = unsafe { OwnedHandle::from_raw_handle(proc_info.h_process) };
        // SAFETY: `CreateProcessW` succeeded and returned an owned thread handle.
        let _thread = unsafe { OwnedHandle::from_raw_handle(proc_info.h_thread) };

        Ok(WindowsAliasChild {
            process,
            pid: proc_info.dw_process_id,
            stdin: Some(File::from(stdin_write)),
            stdout: Some(File::from(stdout_read)),
            exit_status: None,
        })
    }

    impl WindowsAliasChild {
        pub(super) fn wait_with_timeout(
            &mut self,
            timeout_ms: u32,
        ) -> io::Result<Option<ExitStatus>> {
            if let Some(status) = self.exit_status {
                return Ok(Some(status));
            }
            // SAFETY: `self.process` is an open Windows process handle.
            let wait = unsafe { WaitForSingleObject(self.process.as_raw_handle(), timeout_ms) };
            match wait {
                WAIT_OBJECT_0 => {
                    let mut code: u32 = 0;
                    // SAFETY: `self.process` is open and `code` is writable.
                    if unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) } == 0 {
                        return Err(io::Error::last_os_error());
                    }
                    let status = ExitStatus::from_raw(code);
                    self.exit_status = Some(status);
                    Ok(Some(status))
                }
                WAIT_TIMEOUT => Ok(None),
                _ => Err(io::Error::last_os_error()),
            }
        }

        pub(super) fn kill(&mut self) -> io::Result<()> {
            if self.exit_status.is_some() {
                return Ok(());
            }
            // SAFETY: `self.process` is an open Windows process handle.
            if unsafe { TerminateProcess(self.process.as_raw_handle(), 1) } == 0 {
                let error = io::Error::last_os_error();
                if self.wait_with_timeout(0)?.is_some() {
                    return Ok(());
                }
                return Err(error);
            }
            Ok(())
        }
    }
}

#[derive(Debug)]
struct PinnedPluginBinary {
    #[cfg(unix)]
    file_fd: std::os::fd::OwnedFd,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    readable: bool,
    #[cfg(windows)]
    _pinned_handle: std::os::windows::io::OwnedHandle,
}

impl ResolvedPlugin {
    fn pinned_matches_path(&self, binary_path: &Path, metadata: &PluginBinaryMetadata) -> bool {
        #[cfg(unix)]
        if let Some(ref pinned) = self.pinned_binary {
            use std::mem::ManuallyDrop;
            use std::os::fd::{AsRawFd, FromRawFd};
            use std::os::unix::fs::MetadataExt;

            let Ok(path_meta) = fs::metadata(binary_path) else {
                return false;
            };
            if path_meta.dev() != pinned.dev || path_meta.ino() != pinned.ino {
                return false;
            }
            // SAFETY: `pinned.file_fd` is open and owned by `pinned`;
            // `ManuallyDrop` keeps ownership on `pinned` without closing it.
            let pinned_file =
                ManuallyDrop::new(unsafe { fs::File::from_raw_fd(pinned.file_fd.as_raw_fd()) });
            let Ok(fd_meta) = pinned_file.metadata() else {
                return false;
            };
            return fd_meta.dev() == pinned.dev
                && fd_meta.ino() == pinned.ino
                && fd_meta.len() == metadata.length
                && path_meta.len() == metadata.length
                && fd_meta.mtime() == path_meta.mtime()
                && fd_meta.mtime_nsec() == path_meta.mtime_nsec()
                && fd_meta.ctime() == path_meta.ctime()
                && fd_meta.ctime_nsec() == path_meta.ctime_nsec();
        }
        #[cfg(not(unix))]
        let _ = (binary_path, metadata);
        true
    }
}

#[cfg(unix)]
mod unix_pinned_plugin {
    use std::collections::VecDeque;
    use std::ffi::{CString, OsStr, OsString};
    use std::fs;
    use std::io::{self, Read};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::path::{Component, Path, PathBuf};
    use std::sync::Arc;

    use super::{
        PackageManifest, PinnedPluginBinary, PluginFailure, is_blocked_script_extension,
        script_plugin_failure, validate_plugin_binary_relative_path,
    };

    const MAX_SYMLINK_DEPTH: usize = 40;

    #[cfg(target_os = "linux")]
    const DIR_OPEN_FLAGS: libc::c_int = libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC;
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd"
    ))]
    const DIR_OPEN_FLAGS: libc::c_int = libc::O_SEARCH | libc::O_DIRECTORY | libc::O_CLOEXEC;
    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd"
    )))]
    const DIR_OPEN_FLAGS: libc::c_int = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC;

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    const DARWIN_O_EXEC: libc::c_int = 0x4000_0000;

    enum WalkStep {
        Normal(OsString),
        ParentDir,
    }

    enum WalkError {
        Missing { dangling_symlink: bool },
        Escapes,
        SymlinkLoop,
        NotRegularFile,
        InvalidPath,
        Io(io::Error),
    }

    struct WalkedFile {
        file_fd: OwnedFd,
        dev: u64,
        ino: u64,
        readable: bool,
        canonical_path: PathBuf,
    }

    fn cstr_path(path: &OsStr, specifier: &str) -> Result<CString, PluginFailure> {
        CString::new(path.as_bytes()).map_err(|_| {
            PluginFailure::new(
                "PLUGIN_INVALID",
                format!("Binary plugin \"{specifier}\" path contains an interior NUL byte."),
            )
        })
    }

    fn fstat_fd(fd: RawFd) -> io::Result<libc::stat> {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `fd` is open and `stat` is writable.
        if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `fstat` succeeded and initialized `stat`.
        Ok(unsafe { stat.assume_init() })
    }

    fn fstatat_nofollow(dir_fd: RawFd, name: &CString) -> io::Result<libc::stat> {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `dir_fd` is open, `name` is NUL-terminated, and `stat` is writable.
        if unsafe {
            libc::fstatat(
                dir_fd,
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `fstatat` succeeded and initialized `stat`.
        Ok(unsafe { stat.assume_init() })
    }

    fn readlinkat_os(dir_fd: RawFd, name: &CString) -> io::Result<OsString> {
        let mut buf = vec![0_u8; 256];
        loop {
            // SAFETY: `dir_fd` is open, `name` is NUL-terminated, and `buf` is writable.
            let written = unsafe {
                libc::readlinkat(dir_fd, name.as_ptr(), buf.as_mut_ptr().cast(), buf.len())
            };
            if written < 0 {
                return Err(io::Error::last_os_error());
            }
            #[allow(clippy::cast_sign_loss)]
            let len = written as usize;
            if len < buf.len() {
                buf.truncate(len);
                return Ok(OsString::from_vec(buf));
            }
            if buf.len() >= 64 * 1024 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "symlink target exceeds maximum path length",
                ));
            }
            buf.resize(buf.len() * 2, 0);
        }
    }

    fn is_symlink_open_error(raw: Option<i32>) -> bool {
        #[cfg(target_os = "freebsd")]
        if raw == Some(libc::EMLINK) {
            return true;
        }
        #[cfg(target_os = "netbsd")]
        if raw == Some(libc::EFTYPE) {
            return true;
        }
        matches!(raw, Some(libc::ELOOP | libc::ENOTDIR))
    }

    fn canonical_dir_from_fd(fd: RawFd, fallback_path: &Path) -> io::Result<PathBuf> {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            let mut buf = vec![0_u8; libc::PATH_MAX as usize];
            // SAFETY: `fd` is open and `buf` has at least `PATH_MAX` writable bytes.
            if unsafe { libc::fcntl(fd, libc::F_GETPATH, buf.as_mut_ptr()) } == 0 {
                let len = buf.iter().position(|&byte| byte == 0).unwrap_or(buf.len());
                buf.truncate(len);
                if !buf.is_empty() {
                    return Ok(PathBuf::from(OsString::from_vec(buf)));
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(path) = fs::read_link(format!("/proc/self/fd/{fd}"))
                && path.is_absolute()
                && !path.as_os_str().as_bytes().ends_with(b" (deleted)")
            {
                return Ok(path);
            }
        }
        let canonical = fs::canonicalize(fallback_path)?;
        let pinned_stat = fstat_fd(fd)?;
        let path_meta = fs::metadata(&canonical)?;
        use std::os::unix::fs::MetadataExt;
        #[allow(clippy::unnecessary_cast)]
        if path_meta.dev() != pinned_stat.st_dev as u64
            || path_meta.ino() != pinned_stat.st_ino as u64
        {
            return Err(io::Error::other(
                "package directory changed concurrently during pinning",
            ));
        }
        Ok(canonical)
    }

    fn normalize_logical_abs_dir(package_dir: &Path) -> Option<PathBuf> {
        let abs = if package_dir.is_absolute() {
            package_dir.to_path_buf()
        } else {
            std::env::current_dir().ok()?.join(package_dir)
        };
        let mut normalized = PathBuf::new();
        for component in abs.components() {
            match component {
                Component::RootDir => normalized.push(component.as_os_str()),
                Component::Normal(part) => normalized.push(part),
                Component::CurDir => {}
                Component::ParentDir => {
                    normalized.pop();
                }
                Component::Prefix(_) => return None,
            }
        }
        Some(normalized)
    }

    pub(super) struct PinnedPackageDir {
        root_fd: OwnedFd,
        package_dir: PathBuf,
        canonical_dir: PathBuf,
        logical_abs_dir: Option<PathBuf>,
    }

    impl PinnedPackageDir {
        pub(super) fn open(specifier: &str, package_dir: &Path) -> Result<Self, PluginFailure> {
            let c_dir = cstr_path(package_dir.as_os_str(), specifier)?;
            // SAFETY: `c_dir` is a valid C string.
            let root_raw = unsafe { libc::open(c_dir.as_ptr(), DIR_OPEN_FLAGS) };
            if root_raw < 0 {
                return Err(PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Could not pin binary plugin package directory \"{specifier}\" at {}: {}",
                        package_dir.display(),
                        io::Error::last_os_error()
                    ),
                ));
            }
            // SAFETY: `root_raw` is a newly opened valid directory descriptor.
            let root_fd = unsafe { OwnedFd::from_raw_fd(root_raw) };
            let root_stat = fstat_fd(root_fd.as_raw_fd()).map_err(|error| {
                PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Could not inspect binary plugin package directory \"{specifier}\" at {}: {error}",
                        package_dir.display()
                    ),
                )
            })?;
            if (root_stat.st_mode & libc::S_IFMT) != libc::S_IFDIR {
                return Err(PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Binary plugin package \"{specifier}\" at {} is not a directory.",
                        package_dir.display()
                    ),
                ));
            }
            let canonical_dir = canonical_dir_from_fd(root_fd.as_raw_fd(), package_dir).map_err(
                |error| {
                    PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Could not resolve binary plugin package directory \"{specifier}\" at {}: {error}",
                            package_dir.display()
                        ),
                    )
                },
            )?;
            let logical_abs_dir = normalize_logical_abs_dir(package_dir);
            Ok(Self {
                root_fd,
                package_dir: package_dir.to_path_buf(),
                canonical_dir,
                logical_abs_dir,
            })
        }

        pub(super) fn canonical_dir(&self) -> &Path {
            &self.canonical_dir
        }

        pub(super) fn read_manifest(&self) -> io::Result<PackageManifest> {
            let walked = self
                .walk_contained_file(Path::new("package.json"), false)
                .map_err(|error| match error {
                    WalkError::Missing { .. } => {
                        io::Error::new(io::ErrorKind::NotFound, "package.json not found")
                    }
                    WalkError::Escapes => io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "package.json escapes package directory",
                    ),
                    WalkError::SymlinkLoop => {
                        io::Error::new(io::ErrorKind::InvalidData, "package.json symlink loop")
                    }
                    WalkError::NotRegularFile => io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "package.json is not a regular file",
                    ),
                    WalkError::InvalidPath => {
                        io::Error::new(io::ErrorKind::InvalidInput, "invalid package.json path")
                    }
                    WalkError::Io(err) => err,
                })?;
            let mut file = fs::File::from(walked.file_fd);
            let mut contents = String::new();
            file.read_to_string(&mut contents)?;
            serde_json::from_str(&contents).map_err(io::Error::other)
        }

        pub(super) fn resolve_and_pin_binary(
            &self,
            specifier: &str,
            binary: &str,
        ) -> Result<(PathBuf, PathBuf, Arc<PinnedPluginBinary>), PluginFailure> {
            let relative = validate_plugin_binary_relative_path(specifier, binary)?;
            let invocation_path = self.package_dir.join(&relative);
            if is_blocked_script_extension(&invocation_path) {
                return Err(script_plugin_failure(specifier, &invocation_path));
            }
            let walked = self
                .walk_contained_file(&relative, true)
                .map_err(|error| match error {
                    WalkError::Missing {
                        dangling_symlink: true,
                    } => PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Binary plugin package \"{specifier}\" declares palamedes.pluginBinary \"{binary}\" which resolves to an invalid or dangling symlink."
                        ),
                    ),
                    WalkError::Missing {
                        dangling_symlink: false,
                    } => PluginFailure::new(
                        "PLUGIN_BINARY_MISSING",
                        format!(
                            "Configured plugin \"{specifier}\" has no executable at {}.",
                            invocation_path.display()
                        ),
                    ),
                    WalkError::Escapes => PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Binary plugin package \"{specifier}\" declares palamedes.pluginBinary \"{binary}\" which escapes package directory {}.",
                            self.canonical_dir.display()
                        ),
                    ),
                    WalkError::SymlinkLoop => PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Binary plugin package \"{specifier}\" declares palamedes.pluginBinary \"{binary}\" which contains a symlink loop."
                        ),
                    ),
                    WalkError::NotRegularFile => PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Binary plugin \"{specifier}\" executable at {} is not a regular file.",
                            invocation_path.display()
                        ),
                    ),
                    WalkError::InvalidPath => PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Binary plugin package \"{specifier}\" declares invalid palamedes.pluginBinary \"{binary}\"."
                        ),
                    ),
                    WalkError::Io(err) => PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Could not pin binary plugin \"{specifier}\" executable at {}: {err}",
                            invocation_path.display()
                        ),
                    ),
                })?;
            if is_blocked_script_extension(&walked.canonical_path) {
                return Err(script_plugin_failure(specifier, &walked.canonical_path));
            }
            let pinned = Arc::new(PinnedPluginBinary {
                file_fd: walked.file_fd,
                dev: walked.dev,
                ino: walked.ino,
                #[cfg(any(target_os = "linux", target_os = "freebsd"))]
                readable: walked.readable,
            });
            #[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
            let _ = walked.readable;
            Ok((walked.canonical_path, invocation_path, pinned))
        }

        fn expand_symlink_target(
            &self,
            target_os: OsString,
            dir_stack: &mut Vec<(OsString, OwnedFd)>,
            queue: &mut VecDeque<WalkStep>,
        ) -> Result<(), WalkError> {
            let trailing_slash = target_os.as_bytes().ends_with(b"/");
            let target_path = PathBuf::from(target_os);
            let stripped: PathBuf = if target_path.is_absolute() {
                let inside = target_path
                    .strip_prefix(&self.canonical_dir)
                    .or_else(|_| {
                        self.logical_abs_dir
                            .as_deref()
                            .ok_or(())
                            .and_then(|logical| target_path.strip_prefix(logical).map_err(|_| ()))
                    })
                    .map_err(|()| WalkError::Escapes)?;
                dir_stack.clear();
                inside.to_path_buf()
            } else {
                target_path
            };
            let mut steps = Vec::new();
            for component in stripped.components() {
                match component {
                    Component::Normal(part) => steps.push(WalkStep::Normal(part.to_os_string())),
                    Component::ParentDir => steps.push(WalkStep::ParentDir),
                    Component::CurDir => {}
                    Component::RootDir | Component::Prefix(_) => return Err(WalkError::Escapes),
                }
            }
            if trailing_slash && queue.is_empty() {
                return Err(WalkError::NotRegularFile);
            }
            for step in steps.into_iter().rev() {
                queue.push_front(step);
            }
            Ok(())
        }

        fn open_leaf_fd(
            leaf_dir_raw: RawFd,
            c_file: &CString,
            allow_execute_only: bool,
        ) -> Result<(OwnedFd, bool), io::Error> {
            let mut readable = true;
            // SAFETY: `leaf_dir_raw` is open and `c_file` is NUL-terminated.
            let mut file_raw = unsafe {
                libc::openat(
                    leaf_dir_raw,
                    c_file.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
                )
            };
            if allow_execute_only
                && file_raw < 0
                && io::Error::last_os_error().raw_os_error() == Some(libc::EACCES)
            {
                readable = false;
                #[cfg(target_os = "linux")]
                {
                    // SAFETY: `leaf_dir_raw` is open and `c_file` is NUL-terminated.
                    file_raw = unsafe {
                        libc::openat(
                            leaf_dir_raw,
                            c_file.as_ptr(),
                            libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                        )
                    };
                }
                #[cfg(any(target_os = "macos", target_os = "ios"))]
                {
                    // SAFETY: `leaf_dir_raw` is open and `c_file` is NUL-terminated.
                    file_raw = unsafe {
                        libc::openat(
                            leaf_dir_raw,
                            c_file.as_ptr(),
                            DARWIN_O_EXEC | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                        )
                    };
                }
                #[cfg(target_os = "freebsd")]
                {
                    // SAFETY: `leaf_dir_raw` is open and `c_file` is NUL-terminated.
                    file_raw = unsafe {
                        libc::openat(
                            leaf_dir_raw,
                            c_file.as_ptr(),
                            libc::O_EXEC | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                        )
                    };
                }
            }
            if file_raw < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: `file_raw` is a newly opened valid file descriptor.
            Ok((unsafe { OwnedFd::from_raw_fd(file_raw) }, readable))
        }

        fn walk_contained_file(
            &self,
            relative: &Path,
            allow_execute_only: bool,
        ) -> Result<WalkedFile, WalkError> {
            let mut queue = VecDeque::new();
            for component in relative.components() {
                match component {
                    Component::Normal(part) => {
                        queue.push_back(WalkStep::Normal(part.to_os_string()));
                    }
                    _ => return Err(WalkError::InvalidPath),
                }
            }
            if queue.is_empty() {
                return Err(WalkError::NotRegularFile);
            }

            let mut dir_stack: Vec<(OsString, OwnedFd)> = Vec::new();
            let mut symlinks_followed = 0usize;

            while let Some(step) = queue.pop_front() {
                match step {
                    WalkStep::ParentDir => {
                        if dir_stack.pop().is_none() {
                            return Err(WalkError::Escapes);
                        }
                    }
                    WalkStep::Normal(seg) => {
                        let c_seg =
                            CString::new(seg.as_bytes()).map_err(|_| WalkError::InvalidPath)?;
                        let cur_dir_raw = dir_stack
                            .last()
                            .map_or_else(|| self.root_fd.as_raw_fd(), |(_, fd)| fd.as_raw_fd());

                        if !queue.is_empty() {
                            // SAFETY: `cur_dir_raw` is open and `c_seg` is NUL-terminated.
                            let next_raw = unsafe {
                                libc::openat(
                                    cur_dir_raw,
                                    c_seg.as_ptr(),
                                    DIR_OPEN_FLAGS | libc::O_NOFOLLOW,
                                )
                            };
                            if next_raw >= 0 {
                                // SAFETY: `next_raw` is a newly opened valid directory descriptor.
                                dir_stack.push((seg, unsafe { OwnedFd::from_raw_fd(next_raw) }));
                                continue;
                            }
                            let error = io::Error::last_os_error();
                            if error.raw_os_error() == Some(libc::ENOENT) {
                                return Err(WalkError::Missing {
                                    dangling_symlink: symlinks_followed > 0,
                                });
                            }
                            if is_symlink_open_error(error.raw_os_error())
                                && let Ok(st) = fstatat_nofollow(cur_dir_raw, &c_seg)
                                && (st.st_mode & libc::S_IFMT) == libc::S_IFLNK
                            {
                                symlinks_followed += 1;
                                if symlinks_followed > MAX_SYMLINK_DEPTH {
                                    return Err(WalkError::SymlinkLoop);
                                }
                                let target =
                                    readlinkat_os(cur_dir_raw, &c_seg).map_err(WalkError::Io)?;
                                self.expand_symlink_target(target, &mut dir_stack, &mut queue)?;
                                continue;
                            }
                            return Err(WalkError::Io(error));
                        }

                        // Final leaf component.
                        match Self::open_leaf_fd(cur_dir_raw, &c_seg, allow_execute_only) {
                            Ok((file_fd, readable)) => {
                                let stat = fstat_fd(file_fd.as_raw_fd()).map_err(WalkError::Io)?;
                                let kind = stat.st_mode & libc::S_IFMT;
                                if kind == libc::S_IFLNK {
                                    drop(file_fd);
                                    symlinks_followed += 1;
                                    if symlinks_followed > MAX_SYMLINK_DEPTH {
                                        return Err(WalkError::SymlinkLoop);
                                    }
                                    let target = readlinkat_os(cur_dir_raw, &c_seg)
                                        .map_err(WalkError::Io)?;
                                    self.expand_symlink_target(target, &mut dir_stack, &mut queue)?;
                                    continue;
                                }
                                if kind != libc::S_IFREG {
                                    return Err(WalkError::NotRegularFile);
                                }
                                let mut canonical_path = self.canonical_dir.clone();
                                for (name, _) in &dir_stack {
                                    canonical_path.push(name);
                                }
                                canonical_path.push(&seg);
                                #[allow(clippy::unnecessary_cast)]
                                let (dev, ino) = (stat.st_dev as u64, stat.st_ino as u64);
                                return Ok(WalkedFile {
                                    file_fd,
                                    dev,
                                    ino,
                                    readable,
                                    canonical_path,
                                });
                            }
                            Err(error) => {
                                if error.raw_os_error() == Some(libc::ENOENT) {
                                    return Err(WalkError::Missing {
                                        dangling_symlink: symlinks_followed > 0,
                                    });
                                }
                                if is_symlink_open_error(error.raw_os_error())
                                    && let Ok(st) = fstatat_nofollow(cur_dir_raw, &c_seg)
                                    && (st.st_mode & libc::S_IFMT) == libc::S_IFLNK
                                {
                                    symlinks_followed += 1;
                                    if symlinks_followed > MAX_SYMLINK_DEPTH {
                                        return Err(WalkError::SymlinkLoop);
                                    }
                                    let target = readlinkat_os(cur_dir_raw, &c_seg)
                                        .map_err(WalkError::Io)?;
                                    self.expand_symlink_target(target, &mut dir_stack, &mut queue)?;
                                    continue;
                                }
                                return Err(WalkError::Io(error));
                            }
                        }
                    }
                }
            }

            Err(WalkError::NotRegularFile)
        }
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub(super) fn fd_starts_with_shebang(fd: RawFd) -> io::Result<bool> {
        let mut magic = [0_u8; 2];
        // SAFETY: `fd` is open and `magic` is 2 writable bytes.
        let read = unsafe { libc::pread(fd, magic.as_mut_ptr().cast(), magic.len(), 0) };
        if read < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(read == 2 && magic == *b"#!")
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub(super) struct PrebuiltExecArrays {
        _argv_storage: Vec<CString>,
        argv_ptrs: Vec<*const libc::c_char>,
        _envp_storage: Vec<CString>,
        envp_ptrs: Vec<*const libc::c_char>,
    }

    // SAFETY: `argv_ptrs` and `envp_ptrs` point exclusively into the owned
    // heap buffers of `_argv_storage` and `_envp_storage`, which stay pinned at
    // stable addresses for the lifetime of `PrebuiltExecArrays`.
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    unsafe impl Send for PrebuiltExecArrays {}
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    unsafe impl Sync for PrebuiltExecArrays {}

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    impl PrebuiltExecArrays {
        pub(super) fn build(
            invocation_path: &Path,
            env_overrides: &[(&str, &OsStr)],
        ) -> io::Result<Self> {
            let arg0 = CString::new(invocation_path.as_os_str().as_bytes()).map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "plugin invocation path contains interior NUL",
                )
            })?;
            let argv_storage = vec![arg0];
            let argv_ptrs = vec![argv_storage[0].as_ptr(), std::ptr::null()];

            let mut envp_storage = Vec::new();
            for (key, value) in std::env::vars_os() {
                if env_overrides
                    .iter()
                    .any(|&(override_key, _)| key.as_bytes() == override_key.as_bytes())
                {
                    continue;
                }
                let mut entry = Vec::with_capacity(key.len() + 1 + value.len());
                entry.extend_from_slice(key.as_bytes());
                entry.push(b'=');
                entry.extend_from_slice(value.as_bytes());
                if let Ok(cstr) = CString::new(entry) {
                    envp_storage.push(cstr);
                }
            }
            for &(override_key, override_value) in env_overrides {
                let mut entry = Vec::with_capacity(override_key.len() + 1 + override_value.len());
                entry.extend_from_slice(override_key.as_bytes());
                entry.push(b'=');
                entry.extend_from_slice(override_value.as_bytes());
                let entry_cstr = CString::new(entry).map_err(|_| {
                    io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!("environment override {override_key} contains interior NUL"),
                    )
                })?;
                envp_storage.push(entry_cstr);
            }

            let mut envp_ptrs = Vec::with_capacity(envp_storage.len() + 1);
            for item in &envp_storage {
                envp_ptrs.push(item.as_ptr());
            }
            envp_ptrs.push(std::ptr::null());

            Ok(Self {
                _argv_storage: argv_storage,
                argv_ptrs,
                _envp_storage: envp_storage,
                envp_ptrs,
            })
        }

        pub(super) fn argv_ptr(&self) -> *const *const libc::c_char {
            self.argv_ptrs.as_ptr()
        }

        pub(super) fn envp_ptr(&self) -> *const *const libc::c_char {
            self.envp_ptrs.as_ptr()
        }
    }
}

#[cfg(any(windows, test))]
fn windows_wide_root_len(units: &[u16]) -> Option<usize> {
    const BS: u16 = b'\\' as u16;
    const Q: u16 = b'?' as u16;
    const COLON: u16 = b':' as u16;

    if units.len() >= 8
        && units[0] == BS
        && units[1] == BS
        && units[2] == Q
        && units[3] == BS
        && (units[4] == u16::from(b'U') || units[4] == u16::from(b'u'))
        && (units[5] == u16::from(b'N') || units[5] == u16::from(b'n'))
        && (units[6] == u16::from(b'C') || units[6] == u16::from(b'c'))
        && units[7] == BS
    {
        let server_rel = units[8..].iter().position(|&unit| unit == BS)?;
        if server_rel == 0 {
            return None;
        }
        let share_start = 8 + server_rel + 1;
        if share_start >= units.len() {
            return None;
        }
        return match units[share_start..].iter().position(|&unit| unit == BS) {
            Some(0) => None,
            Some(share_rel) => Some(share_start + share_rel + 1),
            None => Some(units.len()),
        };
    }
    if units.len() >= 4 && units[0] == BS && units[1] == BS && units[2] == Q && units[3] == BS {
        return match units[4..].iter().position(|&unit| unit == BS) {
            Some(0) => None,
            Some(vol_rel) => Some(4 + vol_rel + 1),
            None => Some(units.len()),
        };
    }
    if units.len() >= 3
        && u8::try_from(units[0]).is_ok_and(|byte| byte.is_ascii_alphabetic())
        && units[1] == COLON
        && units[2] == BS
    {
        return Some(3);
    }
    None
}

#[cfg(any(windows, test))]
fn windows_parent_wide_path(units: &[u16]) -> Option<&[u16]> {
    const BS: u16 = b'\\' as u16;

    let root_len = windows_wide_root_len(units)?;
    let mut end = units.len();
    while end > root_len && units[end - 1] == BS {
        end -= 1;
    }
    if end <= root_len {
        return None;
    }
    let slash = units[..end].iter().rposition(|&unit| unit == BS)?;
    if slash < root_len {
        Some(&units[..root_len])
    } else {
        Some(&units[..slash])
    }
}

#[cfg(windows)]
mod windows_pinned_plugin {
    use std::ffi::{OsString, c_void};
    use std::fs::{self, File, OpenOptions};
    use std::io::{self, Read};
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, OwnedHandle};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    use super::{
        PackageManifest, PinnedPluginBinary, PluginFailure, is_blocked_script_extension,
        script_plugin_failure, validate_plugin_binary_relative_path, windows_parent_wide_path,
    };

    const FILE_READ_DATA: u32 = 0x0000_0001;
    const FILE_EXECUTE: u32 = 0x0000_0020;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_NAME_NORMALIZED: u32 = 0x0;

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    struct FileIdentity {
        volume_serial: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    impl ByHandleFileInformation {
        fn identity(&self) -> FileIdentity {
            FileIdentity {
                volume_serial: self.volume_serial_number,
                file_index_high: self.file_index_high,
                file_index_low: self.file_index_low,
            }
        }
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandle(
            file: *mut c_void,
            file_information: *mut ByHandleFileInformation,
        ) -> i32;
        fn GetFinalPathNameByHandleW(
            file: *mut c_void,
            path: *mut u16,
            cch_file_path: u32,
            flags: u32,
        ) -> u32;
    }

    fn handle_info(handle: *mut c_void) -> io::Result<ByHandleFileInformation> {
        let mut info = std::mem::MaybeUninit::<ByHandleFileInformation>::zeroed();
        // SAFETY: `handle` is open and `info` is writable.
        if unsafe { GetFileInformationByHandle(handle, info.as_mut_ptr()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `GetFileInformationByHandle` succeeded.
        Ok(unsafe { info.assume_init() })
    }

    fn final_path_units(handle: *mut c_void) -> io::Result<Vec<u16>> {
        let mut buf = vec![0_u16; 260];
        loop {
            let cap = u32::try_from(buf.len()).map_err(|_| io::Error::other("path too long"))?;
            // SAFETY: `handle` is open and `buf` has `cap` writable UTF-16 code units.
            let written = unsafe {
                GetFinalPathNameByHandleW(handle, buf.as_mut_ptr(), cap, FILE_NAME_NORMALIZED)
            };
            if written == 0 {
                return Err(io::Error::last_os_error());
            }
            let written_usize = usize::try_from(written).unwrap_or(usize::MAX);
            if written_usize < buf.len() {
                buf.truncate(written_usize);
                return Ok(buf);
            }
            buf.resize(written_usize + 1, 0);
        }
    }

    /// Verifies that `file_final_units` has the pinned package directory
    /// (`root_dir_id`) as a strict kernel-identity ancestor, walking raw UTF-16
    /// parent paths without case folding or lossy UTF-8 conversion (safe under
    /// per-directory NTFS case sensitivity and unpaired UTF-16 surrogates).
    fn is_strict_descendant_of_dir(
        root_dir_id: FileIdentity,
        file_final_units: &[u16],
    ) -> io::Result<bool> {
        let mut current = file_final_units;
        while let Some(parent_units) = windows_parent_wide_path(current) {
            let parent_path = PathBuf::from(OsString::from_wide(parent_units));
            let dir = match OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES | SYNCHRONIZE)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&parent_path)
            {
                Ok(dir) => dir,
                Err(_) => return Ok(false),
            };
            let info = handle_info(dir.as_raw_handle())?;
            if (info.file_attributes & FILE_ATTRIBUTE_DIRECTORY) == 0
                || (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
            {
                return Ok(false);
            }
            if info.identity() == root_dir_id {
                return Ok(true);
            }
            current = parent_units;
        }
        Ok(false)
    }

    pub(super) struct PinnedPackageDir {
        dir_file: File,
        dir_id: FileIdentity,
        package_dir: PathBuf,
        canonical_dir: PathBuf,
    }

    impl PinnedPackageDir {
        pub(super) fn open(specifier: &str, package_dir: &Path) -> Result<Self, PluginFailure> {
            let dir_file = OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES | SYNCHRONIZE)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .open(package_dir)
                .map_err(|error| {
                    PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Could not pin binary plugin package directory \"{specifier}\" at {}: {error}",
                            package_dir.display()
                        ),
                    )
                })?;
            let info = handle_info(dir_file.as_raw_handle()).map_err(|error| {
                PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Could not inspect binary plugin package directory \"{specifier}\" at {}: {error}",
                        package_dir.display()
                    ),
                )
            })?;
            if (info.file_attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 {
                return Err(PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Binary plugin package \"{specifier}\" at {} is not a directory.",
                        package_dir.display()
                    ),
                ));
            }
            let dir_id = info.identity();
            let dir_final = final_path_units(dir_file.as_raw_handle()).map_err(|error| {
                PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Could not resolve binary plugin package directory \"{specifier}\" at {}: {error}",
                        package_dir.display()
                    ),
                )
            })?;
            let canonical_dir = PathBuf::from(OsString::from_wide(&dir_final));
            Ok(Self {
                dir_file,
                dir_id,
                package_dir: package_dir.to_path_buf(),
                canonical_dir,
            })
        }

        pub(super) fn canonical_dir(&self) -> &Path {
            &self.canonical_dir
        }

        pub(super) fn read_manifest(&self) -> io::Result<PackageManifest> {
            let dir_final = final_path_units(self.dir_file.as_raw_handle())?;
            let manifest_path = PathBuf::from(OsString::from_wide(&dir_final)).join("package.json");
            let mut file = OpenOptions::new()
                .access_mode(FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .open(&manifest_path)?;
            let info = handle_info(file.as_raw_handle())?;
            if (info.file_attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))
                != 0
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "package.json is not a regular file",
                ));
            }
            let manifest_final = final_path_units(file.as_raw_handle())?;
            if !is_strict_descendant_of_dir(self.dir_id, &manifest_final)?
                || final_path_units(file.as_raw_handle())? != manifest_final
            {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "package.json escapes package directory",
                ));
            }
            let mut contents = String::new();
            file.read_to_string(&mut contents)?;
            serde_json::from_str(&contents).map_err(io::Error::other)
        }

        pub(super) fn resolve_and_pin_binary(
            &self,
            specifier: &str,
            binary: &str,
        ) -> Result<(PathBuf, PathBuf, Arc<PinnedPluginBinary>), PluginFailure> {
            let relative = validate_plugin_binary_relative_path(specifier, binary)?;
            let invocation_path = self.package_dir.join(&relative);
            if is_blocked_script_extension(&invocation_path) {
                return Err(script_plugin_failure(specifier, &invocation_path));
            }
            let dir_final = final_path_units(self.dir_file.as_raw_handle()).map_err(|error| {
                PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Could not verify pinned package directory for \"{specifier}\": {error}"
                    ),
                )
            })?;
            let candidate = PathBuf::from(OsString::from_wide(&dir_final)).join(&relative);
            // Hold the verified executable open with `FILE_EXECUTE | FILE_READ_ATTRIBUTES`
            // (supporting execute-only ACLs) and `FILE_SHARE_READ` only (no write or
            // delete sharing) so Windows prevents overwriting, renaming, or deleting
            // the binary or any ancestor directory before launch.
            let bin_file = match OpenOptions::new()
                .access_mode(FILE_EXECUTE | FILE_READ_ATTRIBUTES | SYNCHRONIZE)
                .share_mode(FILE_SHARE_READ)
                .open(&candidate)
            {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    if fs::symlink_metadata(&candidate)
                        .ok()
                        .is_some_and(|metadata| metadata.file_type().is_symlink())
                    {
                        return Err(PluginFailure::new(
                            "PLUGIN_INVALID",
                            format!(
                                "Binary plugin package \"{specifier}\" declares palamedes.pluginBinary \"{binary}\" which resolves to an invalid or dangling symlink."
                            ),
                        ));
                    }
                    return Err(PluginFailure::new(
                        "PLUGIN_BINARY_MISSING",
                        format!(
                            "Configured plugin \"{specifier}\" has no executable at {}.",
                            invocation_path.display()
                        ),
                    ));
                }
                Err(error) => {
                    return Err(PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Could not pin binary plugin \"{specifier}\" executable at {}: {error}",
                            invocation_path.display()
                        ),
                    ));
                }
            };
            let info = handle_info(bin_file.as_raw_handle()).map_err(|error| {
                PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Could not inspect pinned binary plugin \"{specifier}\" at {}: {error}",
                        invocation_path.display()
                    ),
                )
            })?;
            if (info.file_attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))
                != 0
            {
                return Err(PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Binary plugin \"{specifier}\" executable at {} is a directory or reparse point.",
                        invocation_path.display()
                    ),
                ));
            }
            let bin_final = final_path_units(bin_file.as_raw_handle()).map_err(|error| {
                PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!("Could not verify pinned executable for \"{specifier}\": {error}"),
                )
            })?;
            let contained =
                is_strict_descendant_of_dir(self.dir_id, &bin_final).map_err(|error| {
                    PluginFailure::new(
                        "PLUGIN_INVALID",
                        format!(
                            "Could not verify pinned package ancestry for \"{specifier}\": {error}"
                        ),
                    )
                })?;
            if !contained {
                return Err(PluginFailure::new(
                    "PLUGIN_INVALID",
                    format!(
                        "Binary plugin package \"{specifier}\" declares palamedes.pluginBinary \"{binary}\" which escapes package directory {}.",
                        self.canonical_dir.display()
                    ),
                ));
            }
            let canonical_binary = PathBuf::from(OsString::from_wide(&bin_final));
            if is_blocked_script_extension(&canonical_binary) {
                return Err(script_plugin_failure(specifier, &canonical_binary));
            }
            Ok((
                canonical_binary,
                invocation_path,
                Arc::new(PinnedPluginBinary {
                    _pinned_handle: OwnedHandle::from(bin_file),
                }),
            ))
        }
    }
}

#[cfg(unix)]
use unix_pinned_plugin::PinnedPackageDir;
#[cfg(windows)]
use windows_pinned_plugin::PinnedPackageDir;

#[cfg(not(any(unix, windows)))]
struct PinnedPackageDir;

#[cfg(not(any(unix, windows)))]
impl PinnedPackageDir {
    fn open(specifier: &str, _package_dir: &Path) -> Result<Self, PluginFailure> {
        Err(PluginFailure::new(
            "PLUGIN_INVALID",
            format!(
                "Binary plugin package \"{specifier}\" cannot be launched safely because this platform does not support pinned plugin execution."
            ),
        ))
    }

    fn canonical_dir(&self) -> &Path {
        Path::new("")
    }

    fn read_manifest(&self) -> io::Result<PackageManifest> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "pinned plugin execution is not supported on this platform",
        ))
    }

    fn resolve_and_pin_binary(
        &self,
        specifier: &str,
        _binary: &str,
    ) -> Result<(PathBuf, PathBuf, Arc<PinnedPluginBinary>), PluginFailure> {
        Err(PluginFailure::new(
            "PLUGIN_INVALID",
            format!(
                "Binary plugin package \"{specifier}\" cannot be launched safely because this platform does not support pinned plugin execution."
            ),
        ))
    }
}

fn plugin_host_env<'a>(
    resolved: &'a ResolvedPlugin,
    native_executable: &'a Path,
) -> [(&'static str, &'a OsStr); 3] {
    let plugin_dir = resolved
        .invocation_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    [
        (NATIVE_EXECUTABLE_ENV, native_executable.as_os_str()),
        (PLUGIN_PATH_ENV, resolved.invocation_path.as_os_str()),
        (PLUGIN_DIR_ENV, plugin_dir.as_os_str()),
    ]
}

fn spawn_resolved_binary(
    resolved: &ResolvedPlugin,
    cwd: &Path,
    native_executable: &Path,
) -> io::Result<PluginChild> {
    // Keep the verified handle pinned across every platform's spawn call.
    let _pinned_guard = resolved.pinned_binary.as_ref();
    let env_overrides = plugin_host_env(resolved, native_executable);
    #[cfg(windows)]
    if resolved.invocation_path != resolved.binary_path {
        return windows_alias_spawn::spawn_alias_binary(
            &resolved.binary_path,
            &resolved.invocation_path,
            cwd,
            &env_overrides,
        )
        .map(PluginChild::WinAlias);
    }

    #[cfg(unix)]
    let mut command = if let Some(ref pinned) = resolved.pinned_binary {
        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;

            let raw_fd = pinned.file_fd.as_raw_fd();
            let is_shebang = pinned.readable && unix_pinned_plugin::fd_starts_with_shebang(raw_fd)?;
            let exec_arrays = unix_pinned_plugin::PrebuiltExecArrays::build(
                &resolved.invocation_path,
                &env_overrides,
            )?;
            let mut cmd = Command::new(&resolved.binary_path);
            // SAFETY: runs in the forked child after Rust configures stdio
            // pipes, `current_dir`, and process group; invokes
            // `execveat(AT_EMPTY_PATH)` directly on the verified descriptor
            // so the kernel enforces all execute policies (mode, ACLs, noexec,
            // IMA, LSM) with zero pathname lookup and no script body in argv.
            unsafe {
                cmd.pre_exec(move || {
                    if is_shebang && libc::fcntl(raw_fd, libc::F_SETFD, 0) != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    libc::syscall(
                        libc::SYS_execveat,
                        raw_fd,
                        c"".as_ptr(),
                        exec_arrays.argv_ptr(),
                        exec_arrays.envp_ptr(),
                        libc::AT_EMPTY_PATH,
                    );
                    Err(io::Error::last_os_error())
                });
            }
            cmd
        }
        #[cfg(target_os = "freebsd")]
        {
            use std::os::fd::AsRawFd;

            let raw_fd = pinned.file_fd.as_raw_fd();
            let is_shebang = pinned.readable && unix_pinned_plugin::fd_starts_with_shebang(raw_fd)?;
            let exec_arrays = unix_pinned_plugin::PrebuiltExecArrays::build(
                &resolved.invocation_path,
                &env_overrides,
            )?;
            let mut cmd = Command::new(&resolved.binary_path);
            // SAFETY: runs in the forked child after stdio/cwd/pgid setup
            // and replaces the process image directly via `fexecve`.
            unsafe {
                cmd.pre_exec(move || {
                    if is_shebang && libc::fcntl(raw_fd, libc::F_SETFD, 0) != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    libc::fexecve(raw_fd, exec_arrays.argv_ptr(), exec_arrays.envp_ptr());
                    Err(io::Error::last_os_error())
                });
            }
            cmd
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            // Execute via XNU volfs (`/.vol/<dev>/<ino>`) while
            // `pinned.file_fd` keeps the inode allocated and un-reusable:
            // the kernel binds execution directly to `(dev, ino)` with zero
            // directory/symlink lookup, enforces all execute policies (mode,
            // ACLs, MNT_NOEXEC), keeps script contents out of argv, and fails
            // closed if unlinked or on a volume without volfs support.
            let volfs_path = format!("/.vol/{}/{}", pinned.dev, pinned.ino);
            let mut cmd = Command::new(&volfs_path);
            cmd.arg0(&resolved.invocation_path);
            cmd
        }
        #[cfg(not(any(
            target_os = "linux",
            target_os = "freebsd",
            target_os = "macos",
            target_os = "ios"
        )))]
        {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "pinned descriptor plugin execution is not supported on this Unix target",
            ));
        }
    } else {
        let mut cmd = Command::new(&resolved.binary_path);
        if resolved.invocation_path != resolved.binary_path {
            cmd.arg0(&resolved.invocation_path);
        }
        cmd
    };

    #[cfg(not(unix))]
    let mut command = {
        #[cfg(not(windows))]
        let _ = (&resolved.invocation_path, &resolved.pinned_binary);
        Command::new(&resolved.binary_path)
    };
    command.current_dir(cwd);
    for (key, value) in env_overrides {
        command.env(key, value);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    isolate_process_group(&mut command);

    #[cfg(windows)]
    {
        spawn_binary(&mut command).map(PluginChild::Std)
    }
    #[cfg(not(windows))]
    {
        spawn_binary(&mut command).map(PluginChild)
    }
}

fn spawn_binary(command: &mut Command) -> io::Result<Child> {
    #[cfg(unix)]
    {
        for attempt in 1..=PLUGIN_SPAWN_ATTEMPTS {
            match command.spawn() {
                Err(error)
                    if error.raw_os_error() == Some(TEXT_FILE_BUSY_OS_ERROR)
                        && attempt < PLUGIN_SPAWN_ATTEMPTS =>
                {
                    // Package managers and atomic fixture publishers can leave
                    // a freshly replaced executable transiently busy on Linux.
                    thread::sleep(PLUGIN_SPAWN_RETRY_INTERVAL);
                }
                result => return result,
            }
        }
        unreachable!("the final plugin spawn attempt always returns")
    }

    #[cfg(not(unix))]
    {
        command.spawn()
    }
}

fn wait_for_plugin_exit(
    child: &mut PluginChild,
    resolved: &ResolvedPlugin,
    policy: InvocationPolicy,
    started: Instant,
) -> Result<ExitStatus, PluginFailure> {
    let Some(deadline) = policy.deadline else {
        return child.wait().map_err(|error| wait_failure(resolved, error));
    };
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| wait_failure(resolved, error))?
        {
            return Ok(status);
        }
        let Some(remaining) = deadline.checked_sub(started.elapsed()) else {
            return Err(timeout_failure(resolved, policy));
        };
        thread::sleep(remaining.min(CHILD_EXIT_POLL_INTERVAL));
    }
}

fn wait_failure(resolved: &ResolvedPlugin, error: io::Error) -> PluginFailure {
    PluginFailure::new(
        "PLUGIN_BINARY_SPAWN_FAILED",
        format!(
            "Could not wait for binary plugin \"{}\": {error}",
            resolved.specifier
        ),
    )
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
fn terminate_plugin_tree(child: &mut PluginChild) {
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

#[cfg(any(windows, test))]
fn resolve_windows_taskkill(
    system_dir: Option<&Path>,
    system_root: Option<&OsStr>,
) -> Option<PathBuf> {
    if let Some(dir) = system_dir
        && dir.to_str().is_some_and(is_local_windows_drive_root)
    {
        return Some(dir.join("taskkill.exe"));
    }
    let root = system_root.and_then(OsStr::to_str)?;
    if !is_local_windows_drive_root(root) {
        return None;
    }
    Some(Path::new(root).join("System32").join("taskkill.exe"))
}

#[cfg(any(windows, test))]
fn is_local_windows_drive_root(path: &str) -> bool {
    let bytes = path.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || !matches!(bytes[2], b'\\' | b'/')
    {
        return false;
    }
    !path.chars().any(char::is_control) && !path.split(['\\', '/']).any(|segment| segment == "..")
}

#[cfg(windows)]
fn windows_system_directory() -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
    }

    let mut buffer = vec![0_u16; 260];
    loop {
        // SAFETY: `buffer` has `buffer.len()` writable UTF-16 code units.
        let written =
            unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), u32::try_from(buffer.len()).ok()?) };
        if written == 0 {
            return None;
        }
        let written_usize = usize::try_from(written).ok()?;
        if written_usize < buffer.len() {
            buffer.truncate(written_usize);
            return Some(PathBuf::from(OsString::from_wide(&buffer)));
        }
        buffer.resize(written_usize + 1, 0);
    }
}

#[cfg(windows)]
fn terminate_plugin_tree(child: &mut PluginChild) {
    let system_dir = windows_system_directory();
    if let Some(taskkill) =
        resolve_windows_taskkill(system_dir.as_deref(), env::var_os("SystemRoot").as_deref())
            .filter(|path| path.is_file())
    {
        let _ = Command::new(taskkill)
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn terminate_plugin_tree(child: &mut PluginChild) {
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
    fn arm(child: &PluginChild) -> Self {
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

    if package_segments(specifier).is_none() {
        return Err(PluginFailure::new(
            "PLUGIN_INVALID",
            format!(
                "Configured Palamedes binary plugin specifier \"{specifier}\" is not a valid package or path specifier."
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
    let pinned_pkg = PinnedPackageDir::open(specifier, &package_dir)?;
    let manifest = pinned_pkg.read_manifest().map_err(|error| {
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
        let (binary_path, invocation_path, pinned_binary) =
            pinned_pkg.resolve_and_pin_binary(specifier, binary)?;
        return resolved_executable_with_invocation(
            specifier,
            binary_path,
            invocation_path,
            Some(pinned_binary),
        );
    }

    let canonical_dir = pinned_pkg.canonical_dir().to_path_buf();
    let mut candidates = Vec::new();
    for dependency in manifest.optional_dependencies.keys() {
        let Some(dependency_dir) = locate_package_dir(dependency, &canonical_dir) else {
            continue;
        };
        let Ok(pinned_dep) = PinnedPackageDir::open(specifier, &dependency_dir) else {
            continue;
        };
        let Ok(dependency_manifest) = pinned_dep.read_manifest() else {
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
        candidates.push(pinned_dep.resolve_and_pin_binary(specifier, binary)?);
    }

    match candidates.as_slice() {
        [(binary, invocation, pinned)] => resolved_executable_with_invocation(
            specifier,
            binary.clone(),
            invocation.clone(),
            Some(Arc::clone(pinned)),
        ),
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

fn validate_plugin_binary_relative_path(
    specifier: &str,
    binary: &str,
) -> Result<PathBuf, PluginFailure> {
    let invalid = || {
        PluginFailure::new(
            "PLUGIN_INVALID",
            format!(
                "Binary plugin package \"{specifier}\" declares invalid palamedes.pluginBinary \"{binary}\". It must be a relative path within the package directory."
            ),
        )
    };
    if binary.trim().is_empty()
        || binary.chars().any(char::is_control)
        || binary.starts_with('/')
        || binary.starts_with('\\')
        || has_windows_drive_prefix(binary)
    {
        return Err(invalid());
    }
    let relative = binary
        .strip_prefix("./")
        .or_else(|| binary.strip_prefix(r".\"))
        .unwrap_or(binary);
    if relative.is_empty() {
        return Err(invalid());
    }
    let mut normalized = PathBuf::new();
    for segment in relative.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(invalid());
        }
        let mut components = Path::new(segment).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(part)), None) => normalized.push(part),
            _ => return Err(invalid()),
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(invalid());
    }
    Ok(normalized)
}

fn has_windows_drive_prefix(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_blocked_script_extension(path: &Path) -> bool {
    const BLOCKED_SCRIPT_EXTENSIONS: &[&str] =
        &["js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts"];

    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            BLOCKED_SCRIPT_EXTENSIONS
                .iter()
                .any(|blocked| extension.eq_ignore_ascii_case(blocked))
        })
}

fn script_plugin_failure(specifier: &str, binary_path: &Path) -> PluginFailure {
    PluginFailure::new(
        "PLUGIN_BINARY_REQUIRED",
        format!(
            "Configured plugin \"{specifier}\" points to {}. Palamedes CLI plugins must be native executables.",
            binary_path.display()
        ),
    )
}

fn resolved_executable(
    specifier: &str,
    binary_path: PathBuf,
) -> Result<ResolvedPlugin, PluginFailure> {
    let invocation_path = binary_path.clone();
    resolved_executable_with_invocation(specifier, binary_path, invocation_path, None)
}

fn resolved_executable_with_invocation(
    specifier: &str,
    binary_path: PathBuf,
    invocation_path: PathBuf,
    pinned_binary: Option<Arc<PinnedPluginBinary>>,
) -> Result<ResolvedPlugin, PluginFailure> {
    if is_blocked_script_extension(&binary_path) || is_blocked_script_extension(&invocation_path) {
        return Err(script_plugin_failure(specifier, &binary_path));
    }
    if pinned_binary.is_none() {
        if !binary_path.is_file() {
            return Err(PluginFailure::new(
                "PLUGIN_BINARY_MISSING",
                format!(
                    "Configured plugin \"{specifier}\" has no executable at {}.",
                    binary_path.display()
                ),
            ));
        }
        if let Ok(canonical) = fs::canonicalize(&binary_path)
            && is_blocked_script_extension(&canonical)
        {
            return Err(script_plugin_failure(specifier, &canonical));
        }
    }
    Ok(ResolvedPlugin {
        specifier: specifier.to_owned(),
        binary_path,
        invocation_path,
        pinned_binary,
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
        (true, [scope, package]) => {
            let scope_name = scope.strip_prefix('@')?;
            (is_valid_npm_package_segment(scope_name, true)
                && is_valid_npm_package_segment(package, true))
            .then_some(segments)
        }
        (false, [package]) => is_valid_npm_package_segment(package, false).then_some(segments),
        _ => None,
    }
}

fn is_valid_npm_package_segment(segment: &str, allow_leading_underscore: bool) -> bool {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.starts_with('.')
        || (!allow_leading_underscore && segment.starts_with('_'))
        || segment.ends_with('.')
    {
        return false;
    }
    if !segment
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return false;
    }
    let mut components = Path::new(segment).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
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

/// Version of the `pmds <plugin> <command> --json` envelope (`schemaVersion`).
const PLUGIN_JSON_SCHEMA_VERSION: u32 = 1;

/// The one document a plugin command prints with `--json`, for a result and
/// for a host failure alike. Absent names stay `null` rather than disappear.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginJsonEnvelope<'a> {
    ok: bool,
    plugin: Option<&'a str>,
    command: Option<&'a str>,
    exit_code: u8,
    result: Value,
    diagnostics: &'a [PluginDiagnostic],
}

impl PluginJsonEnvelope<'_> {
    fn to_json(&self) -> String {
        serde_json::to_string(&VersionedJson::new(PLUGIN_JSON_SCHEMA_VERSION, self))
            .expect("plugin result JSON")
    }
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
            PluginJsonEnvelope {
                ok: output.exit_code == 0,
                plugin: Some(&invocation.namespace),
                command: invocation.command.as_deref(),
                exit_code: output.exit_code,
                result,
                diagnostics: &output.diagnostics,
            }
            .to_json()
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
    } else if output.outputs.is_empty()
        && let Some(data) = &output.data
    {
        println!(
            "{}",
            serde_json::to_string_pretty(data).expect("plugin data JSON")
        );
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
            PluginJsonEnvelope {
                ok: false,
                plugin: invocation.namespace.as_deref(),
                command: invocation.command.as_deref(),
                exit_code: failure.exit_code,
                result: Value::Null,
                diagnostics: std::slice::from_ref(&diagnostic),
            }
            .to_json()
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
    refresh_plugin_manifests: bool,
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
        let mut refresh_plugin_manifests = false;
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
            } else if value == "--refresh-plugin-manifests" {
                refresh_plugin_manifests = true;
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
            refresh_plugin_manifests,
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

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginBinaryStamp {
    metadata: PluginBinaryMetadata,
    sha256: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginBinaryMetadata {
    length: u64,
    modified_ns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unix_identity: Option<UnixPluginBinaryIdentity>,
}

impl PluginBinaryMetadata {
    fn permits_digest_reuse(&self, current: &Self) -> bool {
        // ctime cannot normally be restored by a writer. Device and inode tie
        // it to the same file object; length and nanosecond mtime cover its
        // visible content metadata. Without every Unix field, rehash instead.
        self == current && current.modified_ns.is_some() && current.unix_identity.is_some()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UnixPluginBinaryIdentity {
    device: u64,
    inode: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
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
    invocation_path: PathBuf,
    pinned_binary: Option<Arc<PinnedPluginBinary>>,
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, Once};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use clap::Command;
    use serde_json::json;

    use std::collections::{BTreeMap, BTreeSet};

    use super::{
        BinaryInvocation, InvocationPolicy, PROTOCOL_VERSION, PluginEvent, PluginInvocation,
        PluginManifest, PluginManifestCache, ResolvedPlugin, command_namespace_tokens, finish_run,
        is_kebab_name, matches_constraint, parse_event, persist_plugin_manifest_cache,
        plugin_catalogs, plugin_manifest_cache_path, reserved_plugin_namespaces,
        resolve_binary_plugin, save_plugin_manifest_cache, validate_manifest,
        validate_manifest_with_reserved_namespaces, write_plugin_manifest_cache_warning_once,
    };
    use crate::config::load_config;
    use palamedes_plugin::ManifestCommand;

    static PLUGIN_REGISTRY_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn reserved_plugin_namespaces_match_the_built_clap_command_tree() {
        assert_eq!(
            reserved_plugin_namespaces(),
            BTreeSet::from_iter(
                [
                    "extract",
                    "lint",
                    "audit",
                    "report",
                    "catalog",
                    "version",
                    "telemetry",
                    "help"
                ]
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
            invocation_path: "/fixture/plugin".into(),
            pinned_binary: None,
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
            "--refresh-plugin-manifests".to_owned(),
            "--config=palamedes.yaml".to_owned(),
            "first".to_owned(),
            "--".to_owned(),
            "--refresh-plugin-manifests".to_owned(),
            "--json".to_owned(),
        ])
        .expect("invocation");

        assert_eq!(invocation.namespace, "acme");
        assert_eq!(invocation.command.as_deref(), Some("inspect"));
        assert_eq!(
            invocation.command_args,
            ["first", "--refresh-plugin-manifests", "--json"]
        );
        assert_eq!(
            invocation.config_path.as_deref(),
            Some(Path::new("palamedes.yaml"))
        );
        assert!(invocation.json);
        assert_eq!(invocation.plugin_timeout, Some(Duration::from_millis(250)));
        assert!(invocation.refresh_plugin_manifests);
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
            invocation_path: "/fixture/plugin".into(),
            pinned_binary: None,
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
        assert_eq!(
            fs::canonicalize(resolved.binary_path).expect("canonical resolved binary"),
            fs::canonicalize(plugin.join("bin/acme")).expect("canonical expected binary")
        );
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
            "plugin.JS",
            "plugin.MJS",
            "plugin.CJS",
            "plugin.TS",
            "plugin.Tsx",
        ] {
            fs::write(root.join(name), "export {};").expect("script fixture");
            let error =
                resolve_binary_plugin(&format!("./{name}"), &config).expect_err("script rejected");
            assert_eq!(error.code, "PLUGIN_BINARY_REQUIRED", "for {name}");
        }
    }

    #[test]
    fn rejects_invalid_and_traversing_package_specifiers() {
        use super::package_segments;

        for valid in [
            "@acme/plugin",
            "@acme/plugin-native",
            "@acme/_catalog",
            "@_scope/catalog",
            "acme.plugin_2",
        ] {
            assert!(package_segments(valid).is_some(), "expected valid: {valid}");
        }
        for invalid in [
            "",
            ".",
            "..",
            "_unscoped",
            ".hidden",
            "@a/..",
            "@../..",
            "@./pkg",
            "@a/.",
            "@a/.hidden",
            "@a/pkg.",
            r"..\..\evil",
            r"@a\..\evil",
            r"@a/..\evil",
            "C:evil",
            r"C:\evil",
            "pkg\0evil",
            "pkg\nevil",
            "@@a/b",
            "@a/b/c",
            "@a/",
            "@",
        ] {
            assert!(
                package_segments(invalid).is_none(),
                "expected invalid package specifier: {invalid:?}"
            );
        }

        let root = temp_dir("invalid-package-specifier");
        let config = root.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");
        for specifier in ["..", "@a/..", "@../..", r"..\..\evil"] {
            let error = resolve_binary_plugin(specifier, &config)
                .expect_err("traversing package specifier rejected");
            assert_eq!(error.code, "PLUGIN_INVALID", "for {specifier}");
        }
    }

    #[test]
    fn optional_dependencies_cannot_traverse_outside_node_modules() {
        let root = temp_dir("optional-dep-traversal");
        let app = root.join("project");
        let plugin = app.join("node_modules/@acme/plugin");
        fs::create_dir_all(&plugin).expect("plugin dir");
        // Place an attacker package above node_modules that `..` / `@a/..` would reach.
        fs::write(
            app.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./evil"}}"#,
        )
        .expect("outer manifest");
        fs::write(app.join("evil"), "fixture").expect("outer binary");
        fs::write(
            plugin.join("package.json"),
            r#"{"optionalDependencies":{"..":"1.0.0","@a/..":"1.0.0","..\\..\\evil":"1.0.0"}}"#,
        )
        .expect("plugin manifest");
        let config = app.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");

        let error = resolve_binary_plugin("@acme/plugin", &config)
            .expect_err("traversal optionalDependencies must not resolve");
        assert_eq!(error.code, "PLUGIN_BINARY_MISSING");
    }

    #[test]
    fn rejects_absolute_and_traversing_plugin_binary_paths() {
        let root = temp_dir("plugin-binary-escape");
        let outside = root.join("outside-bin");
        fs::write(&outside, "fixture").expect("outside binary");
        let plugin = root.join("plugin");
        fs::create_dir_all(plugin.join("bin")).expect("plugin bin dir");
        let config = root.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");

        let absolute_outside = outside.to_string_lossy().replace('\\', "/");
        for binary in [
            absolute_outside.as_str(),
            "../outside-bin",
            "./../outside-bin",
            "bin/../../outside-bin",
            "bin/./acme",
            ".",
            "./",
            r"..\outside-bin",
            "C:/Windows/System32/cmd.exe",
            "bin/acme\0",
        ] {
            let manifest = json!({ "palamedes": { "pluginBinary": binary } });
            fs::write(plugin.join("package.json"), manifest.to_string()).expect("plugin manifest");
            let error = resolve_binary_plugin("./plugin", &config)
                .expect_err("unsafe pluginBinary rejected");
            assert_eq!(error.code, "PLUGIN_INVALID", "for {binary:?}");
        }

        // Case-insensitive script extensions inside palamedes.pluginBinary must also be rejected.
        fs::write(plugin.join("bin/script.JS"), "export {};").expect("uppercase script");
        fs::write(
            plugin.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./bin/script.JS"}}"#,
        )
        .expect("script manifest");
        let error = resolve_binary_plugin("./plugin", &config)
            .expect_err("uppercase script pluginBinary rejected");
        assert_eq!(error.code, "PLUGIN_BINARY_REQUIRED");

        // Contained Windows-relative pluginBinary paths resolve cleanly inside the package.
        fs::write(plugin.join("bin/plugin.exe"), "fixture").expect("windows binary fixture");
        for relative_windows in [r"bin\plugin.exe", r".\bin\plugin.exe"] {
            fs::write(
                plugin.join("package.json"),
                json!({ "palamedes": { "pluginBinary": relative_windows } }).to_string(),
            )
            .expect("windows relative manifest");
            let resolved = resolve_binary_plugin("./plugin", &config)
                .expect("contained Windows-relative pluginBinary should resolve");
            assert_eq!(
                resolved.binary_path,
                fs::canonicalize(plugin.join("bin/plugin.exe")).expect("canonical windows binary"),
                "for {relative_windows}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escaping_package_directory_for_plugin_binary() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("plugin-binary-symlink-escape");
        let outside = root.join("outside-bin");
        fs::write(&outside, "fixture").expect("outside binary");
        let plugin = root.join("plugin");
        fs::create_dir_all(plugin.join("bin")).expect("plugin bin dir");
        symlink(&outside, plugin.join("bin/escaped")).expect("create escaping symlink");
        symlink(root.join("missing-outside"), plugin.join("bin/dangling"))
            .expect("create dangling symlink");
        fs::write(plugin.join("bin/real.MJS"), "export {};").expect("script target");
        symlink(plugin.join("bin/real.MJS"), plugin.join("bin/script-link"))
            .expect("create script symlink");
        fs::write(plugin.join("bin/real-bin"), "fixture").expect("internal binary");
        symlink(
            plugin.join("bin/real-bin"),
            plugin.join("bin/internal-link"),
        )
        .expect("create internal symlink");
        let config = root.join("palamedes.yaml");
        fs::write(&config, "fixture").expect("config");

        for (binary, expected_code) in [
            ("./bin/escaped", "PLUGIN_INVALID"),
            ("./bin/dangling", "PLUGIN_INVALID"),
            ("./bin/script-link", "PLUGIN_BINARY_REQUIRED"),
        ] {
            fs::write(
                plugin.join("package.json"),
                json!({ "palamedes": { "pluginBinary": binary } }).to_string(),
            )
            .expect("plugin manifest");
            let error = resolve_binary_plugin("./plugin", &config)
                .expect_err("symlink escape/script must be rejected");
            assert_eq!(error.code, expected_code, "for {binary}");
        }

        // An internal symlink within the same package directory remains allowed.
        fs::write(
            plugin.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./bin/internal-link"}}"#,
        )
        .expect("internal symlink manifest");
        let resolved =
            resolve_binary_plugin("./plugin", &config).expect("internal symlink allowed");
        assert_eq!(
            resolved.binary_path,
            fs::canonicalize(plugin.join("bin/real-bin")).expect("canonical internal binary")
        );

        // Also enforce containment when resolved via optionalDependencies.
        let modules = root.join("node_modules/@acme");
        let meta = modules.join("meta");
        let platform = modules.join("meta-platform");
        fs::create_dir_all(&meta).expect("meta dir");
        fs::create_dir_all(platform.join("bin")).expect("platform bin dir");
        symlink(&outside, platform.join("bin/escaped")).expect("platform escaping symlink");
        fs::write(
            meta.join("package.json"),
            r#"{"optionalDependencies":{"@acme/meta-platform":"1.0.0"}}"#,
        )
        .expect("meta manifest");
        fs::write(
            platform.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./bin/escaped"}}"#,
        )
        .expect("platform manifest");
        let error = resolve_binary_plugin("@acme/meta", &config)
            .expect_err("optionalDependency symlink escape rejected");
        assert_eq!(error.code, "PLUGIN_INVALID");
    }

    #[test]
    fn resolves_windows_taskkill_only_from_valid_local_system_root() {
        use std::ffi::OsStr;
        use std::path::PathBuf;

        use super::resolve_windows_taskkill;

        // OS-reported System32 directory works even when SystemRoot is unset.
        assert_eq!(
            resolve_windows_taskkill(Some(Path::new(r"C:\Windows\System32")), None),
            Some(PathBuf::from(r"C:\Windows\System32").join("taskkill.exe"))
        );
        assert_eq!(
            resolve_windows_taskkill(None, Some(OsStr::new(r"C:\Windows"))),
            Some(
                PathBuf::from(r"C:\Windows")
                    .join("System32")
                    .join("taskkill.exe")
            )
        );
        assert_eq!(
            resolve_windows_taskkill(None, Some(OsStr::new("D:/Windows"))),
            Some(
                PathBuf::from("D:/Windows")
                    .join("System32")
                    .join("taskkill.exe")
            )
        );
        for invalid in [
            None,
            Some(OsStr::new("")),
            Some(OsStr::new(".")),
            Some(OsStr::new("Windows")),
            Some(OsStr::new(r"..\Windows")),
            Some(OsStr::new(r"\\attacker\share")),
            Some(OsStr::new(r"C:\Windows\..\evil")),
            Some(OsStr::new("C:\\Windows\0")),
        ] {
            assert_eq!(
                resolve_windows_taskkill(None, invalid),
                None,
                "expected invalid SystemRoot to be rejected: {invalid:?}"
            );
        }
    }

    #[test]
    fn validates_manifest_protocol_names_and_built_in_collisions() {
        let resolved = ResolvedPlugin {
            specifier: "@acme/plugin".to_owned(),
            binary_path: "/fixture/plugin".into(),
            invocation_path: "/fixture/plugin".into(),
            pinned_binary: None,
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
    fn retries_a_transient_text_file_busy_spawn() {
        use super::invoke_binary;

        let root = temp_dir("busy-plugin");
        let script = root.join("plugin");
        write_executable_fixture(
            &script,
            "#!/bin/sh\nread _request\n\
             printf '{\"event\":\"result\",\"text\":\"done\",\"exitCode\":0}\\n'\n",
        );
        let writable = fs::OpenOptions::new()
            .write(true)
            .open(&script)
            .expect("hold executable open for writing");
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(15));
            drop(writable);
        });
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            invocation_path: script.clone(),
            binary_path: script,
            pinned_binary: None,
        };

        let invocation = invoke_binary(
            &resolved,
            &json!({ "palamedesBinaryPluginProtocol": 1, "kind": "run" }),
            &root,
            Path::new("pmds"),
            None,
            InvocationPolicy::run(None),
        )
        .expect("transiently busy executable is retried");
        release.join().expect("release writer");

        assert_eq!(invocation.exit_code, 0);
    }

    #[cfg(unix)]
    #[test]
    fn streams_output_events_while_the_plugin_runs() {
        use std::path::Path;

        use super::invoke_binary;

        let root = temp_dir("streaming-plugin");
        let script = root.join("plugin");
        write_executable_fixture(
            &script,
            "#!/bin/sh\nread _request\n\
             printf '{\"event\":\"output\",\"text\":\"one\"}\\n'\n\
             printf '{\"event\":\"output\",\"text\":\"two\"}\\n'\n\
             printf '{\"event\":\"result\",\"text\":\"done\",\"exitCode\":0}\\n'\n",
        );
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            invocation_path: script.clone(),
            binary_path: script,
            pinned_binary: None,
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
        use super::invoke_binary;

        let root = temp_dir("describe-timeout");
        let script = root.join("plugin");
        write_executable_fixture(
            &script,
            "#!/bin/sh\nread _request\nwhile :; do sleep 30; done\n",
        );
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            invocation_path: script.clone(),
            binary_path: script,
            pinned_binary: None,
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
    fn eof_does_not_bypass_the_describe_deadline() {
        use super::invoke_binary;

        let root = temp_dir("describe-eof-timeout");
        let script = root.join("plugin");
        write_executable_fixture(
            &script,
            "#!/bin/sh\nread _request\nexec 1>&-\nwhile :; do sleep 30; done\n",
        );
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            invocation_path: script.clone(),
            binary_path: script,
            pinned_binary: None,
        };
        let policy = InvocationPolicy::new(Some(Duration::from_millis(500)), "describe");

        let started = Instant::now();
        let error = invoke_binary(
            &resolved,
            &json!({ "palamedesBinaryPluginProtocol": 1, "kind": "describe" }),
            &root,
            Path::new("pmds"),
            None,
            policy,
        )
        .expect_err("EOF cannot disable the deadline");

        assert_eq!(error.code, "PLUGIN_BINARY_TIMEOUT");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_plugin_stdout_over_the_total_byte_budget() {
        use super::invoke_binary;

        let root = temp_dir("stdout-budget");
        let script = root.join("plugin");
        write_executable_fixture(
            &script,
            "#!/bin/sh\nread _request\n\
             printf '{\"event\":\"output\",\"text\":\"this is deliberately too large\"}\\n'\n",
        );
        let resolved = ResolvedPlugin {
            specifier: "./plugin".to_owned(),
            invocation_path: script.clone(),
            binary_path: script,
            pinned_binary: None,
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

        // Use a single long-lived group leader. A shell loop would spawn
        // `sleep` descendants whose dead process-group entries can remain
        // visible until the runner's init process reaps them, making the
        // immediate group-existence assertion race with unrelated reaping.
        let mut command = Command::new("/bin/sleep");
        command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        isolate_process_group(&mut command);
        let mut child = super::PluginChild(command.spawn().expect("isolated child"));
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
        let _registry_guard = PLUGIN_REGISTRY_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
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
        write_executable_fixture(
            &script,
            "#!/bin/sh\nread _request\n\
             printf '{\"event\":\"manifest\",\"name\":\"good\",\"protocolVersion\":1,\
             \"commands\":{\"inspect\":{\"description\":\"d\"}}}\\n'\n",
        );
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
        let registry =
            load_registry(&config, &root, Path::new("pmds"), true).expect("degraded registry");

        assert!(registry.plugins.contains_key("good"));
        assert_eq!(registry.skipped.len(), 1);
        assert_eq!(registry.skipped[0].specifier, "./missing");
        assert_eq!(registry.skipped[0].failure.code, "PLUGIN_MISSING");
    }

    #[cfg(unix)]
    #[test]
    fn caches_plugin_manifests_and_supports_explicit_refresh() {
        let _registry_guard = PLUGIN_REGISTRY_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        use super::{
            hash_plugin_binary, load_registry_with_binary_hasher, plugin_manifest_cache_path,
        };

        let root = temp_dir("manifest-cache");
        let plugin = root.join("alpha");
        fs::create_dir_all(&plugin).expect("plugin directory");
        fs::write(
            plugin.join("package.json"),
            r#"{"palamedes":{"pluginBinary":"./describe"}}"#,
        )
        .expect("plugin manifest");
        let script = plugin.join("describe");
        let implementation = plugin.join("implementation");
        write_executable_fixture(
            &script,
            "#!/bin/sh\n# variant-a\n. \"${PALAMEDES_PLUGIN_DIR}/implementation\"\n",
        );
        fs::write(
            &implementation,
            "read _request\nprintf x >> \"${PALAMEDES_PLUGIN_DIR}/counter\"\n\
             printf '{\"event\":\"manifest\",\"name\":\"alpha\",\
             \"protocolVersion\":1,\"commands\":{\"inspect\":{}}}\\n'\n",
        )
        .expect("plugin implementation");
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
",
        )
        .expect("config");
        let config = load_config(&root, None).expect("config with plugin");
        let hash_count = AtomicUsize::new(0);
        let counting_hasher = |path: &Path| {
            hash_count.fetch_add(1, Ordering::SeqCst);
            hash_plugin_binary(path)
        };
        let load = |reuse_cached_manifests| {
            load_registry_with_binary_hasher(
                &config,
                &root,
                Path::new("pmds"),
                reuse_cached_manifests,
                &counting_hasher,
            )
        };

        let first = load(true).expect("initial registry");
        assert_eq!(first.plugins.len(), 1);
        assert_eq!(fs::read_to_string(plugin.join("counter")).unwrap(), "x");
        assert_eq!(hash_count.load(Ordering::SeqCst), 1);
        assert!(plugin_manifest_cache_path(&config).is_file());

        let warm = load(true).expect("cached registry");
        assert_eq!(warm.plugins.len(), 1);
        assert_eq!(fs::read_to_string(plugin.join("counter")).unwrap(), "x");
        assert_eq!(hash_count.load(Ordering::SeqCst), 1);

        let original_metadata = fs::metadata(&script).expect("plugin script metadata");
        let original_mtime = original_metadata.modified().expect("plugin script mtime");
        let changed = fs::read_to_string(&script)
            .expect("plugin script")
            .replace("variant-a", "variant-b");
        assert_eq!(changed.len() as u64, original_metadata.len());
        write_executable_fixture(&script, changed);
        fs::OpenOptions::new()
            .write(true)
            .open(&script)
            .expect("plugin script")
            .set_times(fs::FileTimes::new().set_modified(original_mtime))
            .expect("restore plugin script mtime");
        let replacement_metadata = fs::metadata(&script).expect("replacement metadata");
        assert_eq!(replacement_metadata.len(), original_metadata.len());
        assert_eq!(replacement_metadata.modified().unwrap(), original_mtime);

        let replaced = load(true).expect("replaced executable registry");
        assert_eq!(replaced.plugins.len(), 1);
        assert_eq!(fs::read_to_string(plugin.join("counter")).unwrap(), "xx");
        assert_eq!(hash_count.load(Ordering::SeqCst), 2);

        let warm = load(true).expect("replacement cache hit");
        assert_eq!(warm.plugins.len(), 1);
        assert_eq!(fs::read_to_string(plugin.join("counter")).unwrap(), "xx");
        assert_eq!(hash_count.load(Ordering::SeqCst), 2);

        let changed = fs::read_to_string(&implementation)
            .expect("plugin implementation")
            .replace("inspect", "refreshed");
        fs::write(&implementation, changed).expect("change plugin implementation");
        let stale = load(true).expect("unchanged shim stays cached");
        assert!(
            stale.plugins["alpha"]
                .manifest
                .commands
                .contains_key("inspect")
        );
        assert_eq!(fs::read_to_string(plugin.join("counter")).unwrap(), "xx");
        assert_eq!(hash_count.load(Ordering::SeqCst), 2);

        let explicitly_refreshed = load(false).expect("explicitly refreshed registry");
        assert!(
            explicitly_refreshed.plugins["alpha"]
                .manifest
                .commands
                .contains_key("refreshed")
        );
        assert_eq!(fs::read_to_string(plugin.join("counter")).unwrap(), "xxx");
        assert_eq!(hash_count.load(Ordering::SeqCst), 3);

        let warm = load(true).expect("refreshed cache is reusable");
        assert!(
            warm.plugins["alpha"]
                .manifest
                .commands
                .contains_key("refreshed")
        );
        assert_eq!(fs::read_to_string(plugin.join("counter")).unwrap(), "xxx");
        assert_eq!(hash_count.load(Ordering::SeqCst), 3);
    }

    #[cfg(unix)]
    #[test]
    fn cached_manifests_still_enforce_namespace_collisions() {
        let _registry_guard = PLUGIN_REGISTRY_TEST_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
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
            write_executable_fixture(
                &script,
                "#!/bin/sh\nread _request\nprintf x >> \"${PALAMEDES_PLUGIN_DIR}/counter\"\n\
                 printf '{\"event\":\"manifest\",\"name\":\"shared\",\
                 \"protocolVersion\":1,\"commands\":{\"inspect\":{}}}\\n'\n",
            );
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
            let error = load_registry(&config, &root, Path::new("pmds"), true)
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

    #[test]
    fn invalidates_manifest_cache_entries_from_the_previous_stamp_schema() {
        use super::{
            PLUGIN_MANIFEST_CACHE_SCHEMA, load_plugin_manifest_cache, plugin_manifest_cache_path,
        };

        let root = temp_dir("old-manifest-cache-schema");
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
        )
        .expect("config");
        let config = load_config(&root, None).expect("load config");
        let cache_path = plugin_manifest_cache_path(&config);
        fs::create_dir_all(cache_path.parent().expect("cache parent")).expect("cache directory");
        let old_cache = json!({
            "schema": 2,
            "protocolVersion": PROTOCOL_VERSION,
            "hostVersion": env!("CARGO_PKG_VERSION"),
            "entries": {
                "/plugin": {
                    "stamp": {
                        "length": 1,
                        "modifiedNs": 1,
                        "sha256": vec![0_u8; 32]
                    },
                    "manifest": {
                        "name": "cached",
                        "protocolVersion": PROTOCOL_VERSION,
                        "commands": {"inspect": {}}
                    }
                }
            }
        });
        fs::write(
            &cache_path,
            serde_json::to_vec(&old_cache).expect("old cache JSON"),
        )
        .expect("old cache");

        let loaded = load_plugin_manifest_cache(&config);
        assert_eq!(loaded.schema, PLUGIN_MANIFEST_CACHE_SCHEMA);
        assert!(loaded.entries.is_empty());
    }

    #[test]
    fn plugin_cache_identity_rehashes_without_complete_unix_metadata() {
        use super::{
            PluginBinaryStamp, hash_plugin_binary, plugin_binary_metadata, plugin_cache_identity,
        };

        let root = temp_dir("manifest-cache-metadata-fallback");
        let binary = root.join("plugin");
        fs::write(&binary, "plugin bytes").expect("plugin binary");
        let binary = fs::canonicalize(binary).expect("canonical plugin binary");
        let mut metadata = plugin_binary_metadata(&fs::metadata(&binary).expect("metadata"));
        metadata.unix_identity = None;
        let cached = PluginBinaryStamp {
            metadata,
            sha256: [0; 32],
        };
        let hash_count = AtomicUsize::new(0);
        let counting_hasher = |path: &Path| {
            hash_count.fetch_add(1, Ordering::SeqCst);
            hash_plugin_binary(path)
        };

        let (_, actual) = plugin_cache_identity(&binary, Some(&cached), &counting_hasher)
            .expect("cache identity");
        assert_eq!(hash_count.load(Ordering::SeqCst), 1);
        assert_ne!(actual.sha256, cached.sha256);
    }

    #[cfg(unix)]
    #[test]
    fn coarse_or_missing_unix_identity_never_enables_digest_reuse() {
        use super::unix_plugin_binary_identity_from_parts;

        assert!(unix_plugin_binary_identity_from_parts(1, 2, 3, 4, 5, 6).is_some());
        assert!(unix_plugin_binary_identity_from_parts(1, 2, 3, 4, 5, 0).is_none());
        assert!(unix_plugin_binary_identity_from_parts(1, 0, 3, 4, 5, 6).is_none());
    }

    #[test]
    fn reports_plugin_manifest_cache_write_failures_once() {
        let root = temp_dir("manifest-cache-warning");
        fs::write(
            root.join("palamedes.yaml"),
            "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
        )
        .expect("config");
        let config = load_config(&root, None).expect("load config");
        fs::write(root.join(".palamedes"), "not a directory")
            .expect("block cache directory creation");

        let error = save_plugin_manifest_cache(&config, &PluginManifestCache::fresh())
            .expect_err("cache save must fail");
        let path = plugin_manifest_cache_path(&config);
        let warning = Once::new();
        let mut output = Vec::new();
        write_plugin_manifest_cache_warning_once(&warning, &path, &error, &mut output);
        write_plugin_manifest_cache_warning_once(&warning, &path, &error, &mut output);

        let output = String::from_utf8(output).expect("utf-8 warning");
        assert_eq!(output.matches("Warning:").count(), 1, "{output}");
        assert!(output.contains(&path.display().to_string()), "{output}");
        assert!(output.contains(&error.to_string()), "{output}");
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

    #[cfg(unix)]
    fn write_executable_fixture(path: &Path, contents: impl AsRef<[u8]>) {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let temporary = path.with_extension(format!("fixture-{nonce}"));
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .expect("create executable fixture");
        file.write_all(contents.as_ref())
            .expect("write executable fixture");
        file.sync_all().expect("sync executable fixture");
        drop(file);
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o755))
            .expect("chmod executable fixture");
        fs::rename(&temporary, path).expect("publish executable fixture");
    }

    /// The `--json` envelope is a public contract: `schemaVersion` leads, and
    /// an unknown command stays an explicit `null`.
    #[test]
    fn json_envelope_leads_with_its_schema_version() {
        let diagnostic = super::PluginDiagnostic {
            severity: super::Severity::Error,
            message: "failed".to_owned(),
            code: Some("PLUGIN_TEST".to_owned()),
            details: None,
        };
        let envelope = super::PluginJsonEnvelope {
            ok: false,
            plugin: Some("acme"),
            command: None,
            exit_code: 1,
            result: serde_json::Value::Null,
            diagnostics: std::slice::from_ref(&diagnostic),
        }
        .to_json();

        assert!(
            envelope.starts_with("{\"schemaVersion\":1,\"ok\":false,"),
            "{envelope}"
        );
        let value: serde_json::Value = serde_json::from_str(&envelope).expect("envelope JSON");
        assert_eq!(
            value,
            json!({
                "schemaVersion": 1,
                "ok": false,
                "plugin": "acme",
                "command": null,
                "exitCode": 1,
                "result": null,
                "diagnostics": [{ "severity": "error", "message": "failed", "code": "PLUGIN_TEST" }],
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_in_package_plugin_binary_preserves_declared_argv0() {
        let root = temp_dir("plugin-symlink-argv0");
        let pkg_dir = root.join("node_modules/acme-multicall");
        let bin_dir = pkg_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("create bin dir");
        fs::write(
            pkg_dir.join("package.json"),
            r#"{"name":"acme-multicall","palamedes":{"pluginBinary":"bin/acme-plugin"}}"#,
        )
        .expect("write package.json");
        let target_bin = bin_dir.join("multicall-runner");
        let source_path = root.join("multicall.c");
        fs::write(
            &source_path,
            concat!(
                "#include <stdio.h>\n",
                "#include <string.h>\n",
                "int main(int argc, char **argv) {\n",
                "  const char *arg0 = argc > 0 && argv[0] ? argv[0] : \"\";\n",
                "  const char *slash = strrchr(arg0, '/');\n",
                "  const char *base = slash ? slash + 1 : arg0;\n",
                "  if (strcmp(base, \"acme-plugin\") == 0) {\n",
                "    puts(\"{\\\"event\\\":\\\"manifest\\\",\\\"name\\\":\\\"acme\\\",\\\"protocolVersion\\\":1,\\\"commands\\\":{\\\"ping\\\":{}}}\");\n",
                "    return 0;\n",
                "  }\n",
                "  fprintf(stderr, \"unexpected argv0: %s\\n\", arg0);\n",
                "  return 42;\n",
                "}\n",
            ),
        )
        .expect("write C fixture source");
        let compiled = std::process::Command::new("cc")
            .arg(&source_path)
            .arg("-o")
            .arg(&target_bin)
            .status()
            .is_ok_and(|status| status.success());
        if !compiled {
            // Fallback placeholder executable when no C compiler is on PATH.
            write_executable_fixture(&target_bin, "#!/bin/sh\nexit 0\n");
        }
        let symlink_path = bin_dir.join("acme-plugin");
        std::os::unix::fs::symlink(&target_bin, &symlink_path).expect("create in-package symlink");
        let config_path = root.join("palamedes.yaml");
        fs::write(&config_path, "locales: [en]\nsource-locale: en\n").expect("write config");

        let resolved =
            super::resolve_binary_plugin("acme-multicall", &config_path).expect("resolve plugin");
        assert_eq!(
            resolved.binary_path,
            fs::canonicalize(&target_bin).expect("canonical target")
        );
        assert_eq!(resolved.invocation_path, symlink_path);

        if compiled {
            let manifest = super::describe_resolved_plugin(&resolved, &root, Path::new("pmds"))
                .expect("multicall symlinked native plugin must receive declared argv0");
            assert_eq!(manifest.name, "acme");
        }
    }

    #[cfg(unix)]
    #[test]
    fn pinned_package_plugin_binary_resists_directory_swap_before_launch() {
        let root = temp_dir("plugin-pinned-swap");
        let pkg_dir = root.join("node_modules/acme-pinned");
        let bin_dir = pkg_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("create bin dir");
        fs::write(
            pkg_dir.join("package.json"),
            r#"{"name":"acme-pinned","palamedes":{"pluginBinary":"bin/acme-plugin"}}"#,
        )
        .expect("write package.json");
        let original_bin = bin_dir.join("acme-plugin");
        write_executable_fixture(
            &original_bin,
            "#!/bin/sh\necho '{\"event\":\"manifest\",\"name\":\"verified-original\",\"protocolVersion\":1,\"commands\":{\"ping\":{}}}'\n",
        );

        let evil_dir = temp_dir("plugin-pinned-evil");
        let evil_bin_dir = evil_dir.join("bin");
        fs::create_dir_all(&evil_bin_dir).expect("create evil bin dir");
        write_executable_fixture(
            &evil_bin_dir.join("acme-plugin"),
            "#!/bin/sh\necho '{\"event\":\"manifest\",\"name\":\"evil-swapped\",\"protocolVersion\":1,\"commands\":{\"ping\":{}}}'\n",
        );

        let config_path = root.join("palamedes.yaml");
        fs::write(&config_path, "locales: [en]\nsource-locale: en\n").expect("write config");
        let resolved =
            super::resolve_binary_plugin("acme-pinned", &config_path).expect("resolve plugin");
        assert!(resolved.pinned_binary.is_some());

        // Swap the package directory to a symlink pointing outside after resolution.
        let moved_pkg = root.join("node_modules/acme-pinned-moved");
        fs::rename(&pkg_dir, &moved_pkg).expect("move original package dir");
        std::os::unix::fs::symlink(&evil_dir, &pkg_dir).expect("swap symlink to evil dir");

        let manifest = super::describe_resolved_plugin(&resolved, &root, Path::new("pmds"))
            .expect("pinned plugin must launch verified original binary");
        assert_eq!(
            manifest.name, "verified-original",
            "swapped package directory must never redirect execution to attacker binary"
        );

        // Replacing the binary inode in-place must fail closed instead of launching a new inode.
        fs::remove_file(moved_pkg.join("bin/acme-plugin")).expect("unlink original");
        write_executable_fixture(
            &moved_pkg.join("bin/acme-plugin"),
            "#!/bin/sh\necho '{\"event\":\"manifest\",\"name\":\"replaced-inode\",\"protocolVersion\":1,\"commands\":{\"ping\":{}}}'\n",
        );
        #[cfg(not(target_os = "linux"))]
        assert!(
            super::describe_resolved_plugin(&resolved, &root, Path::new("pmds")).is_err(),
            "unlinked and replaced plugin binary must fail closed"
        );
        #[cfg(target_os = "linux")]
        {
            let still_original =
                super::describe_resolved_plugin(&resolved, &root, Path::new("pmds"))
                    .expect("Linux execveat executes the original unlinked inode");
            assert_eq!(still_original.name, "verified-original");
        }
    }

    #[cfg(unix)]
    #[test]
    fn execute_only_package_plugin_binary_runs_and_cache_fingerprints_pinned_inode() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("plugin-exec-only");
        let pkg_dir = root.join("node_modules/acme-execonly");
        let bin_dir = pkg_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("create bin dir");
        fs::write(
            pkg_dir.join("package.json"),
            r#"{"name":"acme-execonly","palamedes":{"pluginBinary":"bin/acme-exec"}}"#,
        )
        .expect("write package.json");
        let target_bin = bin_dir.join("acme-exec");
        let source_path = root.join("exec_only.c");
        fs::write(
            &source_path,
            concat!(
                "#include <stdio.h>\n",
                "int main(void) {\n",
                "  puts(\"{\\\"event\\\":\\\"manifest\\\",\\\"name\\\":\\\"execonly\\\",\\\"protocolVersion\\\":1,\\\"commands\\\":{\\\"ping\\\":{}}}\");\n",
                "  return 0;\n",
                "}\n",
            ),
        )
        .expect("write C fixture source");
        let compiled = std::process::Command::new("cc")
            .arg(&source_path)
            .arg("-o")
            .arg(&target_bin)
            .status()
            .is_ok_and(|status| status.success());
        if !compiled {
            return;
        }
        fs::set_permissions(&target_bin, fs::Permissions::from_mode(0o111))
            .expect("chmod 0111 binary");
        let config_path = root.join("palamedes.yaml");
        fs::write(&config_path, "locales: [en]\nsource-locale: en\n").expect("write config");

        let resolved = super::resolve_binary_plugin("acme-execonly", &config_path)
            .expect("execute-only 0111 native plugin must resolve and pin without read permission");
        let manifest = super::describe_resolved_plugin(&resolved, &root, Path::new("pmds"))
            .expect("execute-only 0111 native plugin must run");
        assert_eq!(manifest.name, "execonly");

        // Restore read permissions so we can verify replacement-after-pinning
        // skips manifest caching rather than attributing the old manifest to a new binary.
        fs::set_permissions(&target_bin, fs::Permissions::from_mode(0o755))
            .expect("restore permissions");
        let resolved_readable = super::resolve_binary_plugin("acme-execonly", &config_path)
            .expect("resolve readable plugin");
        assert!(
            super::plugin_cache_identity_for_resolved(
                &resolved_readable,
                &resolved_readable.binary_path,
                None,
                &super::hash_plugin_binary,
            )
            .is_some(),
            "cache identity succeeds while pathname matches pinned inode"
        );
        let replacement = bin_dir.join("acme-exec.new");
        fs::write(&replacement, b"replacement-bytes").expect("write replacement");
        fs::rename(&replacement, &target_bin).expect("replace binary inode");
        assert!(
            super::plugin_cache_identity_for_resolved(
                &resolved_readable,
                &resolved_readable.binary_path,
                None,
                &super::hash_plugin_binary,
            )
            .is_none(),
            "cache identity must skip caching once pathname no longer names pinned inode"
        );
    }

    #[test]
    fn windows_alias_command_line_and_env_block_preserve_declared_argv0() {
        let invocation: Vec<u16> = r"C:\repo\node_modules\acme\bin\acme-plugin.exe"
            .encode_utf16()
            .collect();
        let cmd_line = super::encode_windows_argv0_command_line(&invocation).expect("quoted argv0");
        assert_eq!(
            String::from_utf16(&cmd_line).expect("UTF-16"),
            "\"C:\\repo\\node_modules\\acme\\bin\\acme-plugin.exe\"\0"
        );
        assert!(
            super::encode_windows_argv0_command_line(&[]).is_err(),
            "empty invocation path must fail"
        );
        let with_quote: Vec<u16> = "C:\\bad\"path.exe".encode_utf16().collect();
        assert!(
            super::encode_windows_argv0_command_line(&with_quote).is_err(),
            "embedded quote in invocation path must fail"
        );

        let override_val: Vec<u16> = r"C:\bin\pmds.exe".encode_utf16().collect();
        let plugin_dir_val: Vec<u16> = r"C:\repo\node_modules\acme\bin".encode_utf16().collect();
        let block = super::build_windows_environment_block_units(
            vec![
                (
                    "path".encode_utf16().collect(),
                    r"C:\Windows".encode_utf16().collect(),
                ),
                (
                    super::NATIVE_EXECUTABLE_ENV
                        .to_ascii_lowercase()
                        .encode_utf16()
                        .collect(),
                    r"C:\stale\pmds.exe".encode_utf16().collect(),
                ),
                (
                    "ALPHA".encode_utf16().collect(),
                    "1".encode_utf16().collect(),
                ),
            ],
            &[
                (super::NATIVE_EXECUTABLE_ENV, &override_val),
                (super::PLUGIN_DIR_ENV, &plugin_dir_val),
            ],
        )
        .expect("Windows environment block");
        let rendered = String::from_utf16(&block).expect("UTF-16 env block");
        let entries: Vec<&str> = rendered
            .strip_suffix("\0\0")
            .expect("double-NUL terminated")
            .split('\0')
            .collect();
        assert_eq!(
            entries,
            vec![
                "ALPHA=1",
                &format!("{}=C:\\bin\\pmds.exe", super::NATIVE_EXECUTABLE_ENV),
                &format!(
                    "{}=C:\\repo\\node_modules\\acme\\bin",
                    super::PLUGIN_DIR_ENV
                ),
                "path=C:\\Windows",
            ]
        );
    }

    #[test]
    fn windows_parent_wide_path_walks_utf16_ancestors_without_folding() {
        let to_u16 = |s: &str| s.encode_utf16().collect::<Vec<u16>>();
        let from_u16 = |u: &[u16]| String::from_utf16(u).expect("valid UTF-16");

        let drive = to_u16(r"\\?\C:\Pkg\bin\tool.exe");
        let p1 = super::windows_parent_wide_path(&drive).expect("bin dir");
        assert_eq!(from_u16(p1), r"\\?\C:\Pkg\bin");
        let p2 = super::windows_parent_wide_path(p1).expect("pkg dir");
        assert_eq!(from_u16(p2), r"\\?\C:\Pkg");
        let p3 = super::windows_parent_wide_path(p2).expect("drive root");
        assert_eq!(from_u16(p3), r"\\?\C:\");
        assert!(super::windows_parent_wide_path(p3).is_none());

        let unc = to_u16(r"\\?\UNC\server\share\pkg\tool.exe");
        let u1 = super::windows_parent_wide_path(&unc).expect("unc pkg");
        assert_eq!(from_u16(u1), r"\\?\UNC\server\share\pkg");
        let u2 = super::windows_parent_wide_path(u1).expect("unc root");
        assert_eq!(from_u16(u2), r"\\?\UNC\server\share\");
        assert!(super::windows_parent_wide_path(u2).is_none());

        // Preserve unpaired UTF-16 surrogates intact while walking parents.
        let mut with_surrogate = to_u16(r"\\?\C:\");
        with_surrogate.push(0xD800);
        with_surrogate.extend(to_u16(r"\bin\tool.exe"));
        let s1 = super::windows_parent_wide_path(&with_surrogate).expect("bin");
        let s2 = super::windows_parent_wide_path(s1).expect("surrogate dir");
        assert_eq!(s2[7], 0xD800);
        assert_eq!(s2.len(), 8);
    }

    #[cfg(unix)]
    #[test]
    fn private_env_bash_package_plugin_runs_via_kernel_and_invokes_sibling_executable() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("plugin-private-env-bash");
        let pkg_dir = root.join("node_modules/acme-env-wrapper");
        let bin_dir = pkg_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("create bin dir");
        fs::write(
            pkg_dir.join("package.json"),
            r#"{"name":"acme-env-wrapper","palamedes":{"pluginBinary":"bin/acme-wrapper"}}"#,
        )
        .expect("write package.json");
        let sibling = bin_dir.join("real-plugin");
        write_executable_fixture(
            &sibling,
            concat!(
                "#!/bin/sh\n",
                "printf '{\"event\":\"manifest\",\"name\":\"env-wrapper-sibling\",\"protocolVersion\":1,\"commands\":{\"ping\":{}}}\\n'\n",
            ),
        );
        let wrapper = bin_dir.join("acme-wrapper");
        write_executable_fixture(
            &wrapper,
            concat!(
                "#!/usr/bin/env bash\n",
                "# PRIVATE_TOKEN_MUST_NOT_APPEAR_IN_ARGV\n",
                "if [ \"$#\" -ne 0 ]; then exit 99; fi\n",
                "if [ \"${PALAMEDES_PLUGIN_PATH}\" != \"${PALAMEDES_PLUGIN_DIR}/acme-wrapper\" ]; then exit 98; fi\n",
                "exec \"${PALAMEDES_PLUGIN_DIR}/real-plugin\"\n",
            ),
        );
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).expect("chmod 0700");

        let config_path = root.join("palamedes.yaml");
        fs::write(&config_path, "locales: [en]\nsource-locale: en\n").expect("write config");
        let resolved =
            super::resolve_binary_plugin("acme-env-wrapper", &config_path).expect("resolve plugin");
        let manifest = super::describe_resolved_plugin(&resolved, &root, Path::new("pmds")).expect(
            "private env bash wrapper must launch sibling executable via PALAMEDES_PLUGIN_DIR",
        );
        assert_eq!(manifest.name, "env-wrapper-sibling");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_acl_deny_execute_blocks_shell_plugin_wrapper() {
        let Ok(whoami) = std::process::Command::new("/usr/bin/id")
            .arg("-un")
            .output()
        else {
            return;
        };
        if !whoami.status.success() {
            return;
        }
        let user = String::from_utf8_lossy(&whoami.stdout).trim().to_owned();
        if user.is_empty() {
            return;
        }
        let root = temp_dir("plugin-macos-acl-deny-exec");
        let pkg_dir = root.join("node_modules/acme-denied");
        let bin_dir = pkg_dir.join("bin");
        fs::create_dir_all(&bin_dir).expect("create bin dir");
        fs::write(
            pkg_dir.join("package.json"),
            r#"{"name":"acme-denied","palamedes":{"pluginBinary":"bin/acme-plugin"}}"#,
        )
        .expect("write package.json");
        let script = bin_dir.join("acme-plugin");
        write_executable_fixture(
            &script,
            "#!/bin/sh\necho '{\"event\":\"manifest\",\"name\":\"should-not-run\",\"protocolVersion\":1,\"commands\":{\"ping\":{}}}'\n",
        );
        let acl_applied = std::process::Command::new("/bin/chmod")
            .arg("+a")
            .arg(format!("user:{user} deny execute"))
            .arg(&script)
            .status()
            .is_ok_and(|status| status.success());
        if !acl_applied {
            return;
        }
        // Confirm the kernel/filesystem actually enforces the deny-execute ACL
        // for a direct launch before asserting pinned launch behavior.
        let direct_denied = std::process::Command::new(&script)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_err_and(|err| err.kind() == std::io::ErrorKind::PermissionDenied);
        if !direct_denied {
            return;
        }

        let config_path = root.join("palamedes.yaml");
        fs::write(&config_path, "locales: [en]\nsource-locale: en\n").expect("write config");
        let resolved =
            super::resolve_binary_plugin("acme-denied", &config_path).expect("resolve plugin");
        let error = super::describe_resolved_plugin(&resolved, &root, Path::new("pmds"))
            .expect_err("macOS deny-execute ACL must prevent pinned shell plugin execution");
        assert_eq!(error.code, "PLUGIN_BINARY_SPAWN_FAILED");
    }
}
