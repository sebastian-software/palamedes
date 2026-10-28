//! Native invocation owner. No collection or project discovery before consent.

use crate::error::CliError;
use crate::update_check::{RELEASE_NETWORK_ENABLED, SERVICE_ORIGIN};
use app_tracking::project::{Origin, RepositoryContext};
use app_tracking::telemetry::{CONSENT_REVISION, Client, Control, Invocation, Policy};
use clap::{Args, Subcommand};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const DISCLOSURE: &str = include_str!("../telemetry-notice.txt");

/// Handle the shared worker before locale setup, CLI parsing, project lookup,
/// update checks, or command counting. Worker failures never print user output.
pub fn worker_entry() -> Option<u8> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref()
        != Some(std::ffi::OsStr::new(
            app_tracking::telemetry::BACKGROUND_WORKER_ARGUMENT,
        ))
    {
        return None;
    }
    let token = args.next().and_then(|value| value.into_string().ok());
    let success = token
        .filter(|_| args.next().is_none())
        .is_some_and(|token| {
            configured(false).is_some_and(|(client, policy)| {
                client.run_background_worker(&policy, &token).is_ok()
            })
        });
    Some(u8::from(!success))
}

#[derive(Debug, Args)]
pub struct Options {
    #[command(subcommand)]
    command: Operation,
}

#[derive(Debug, Subcommand)]
enum Operation {
    /// Unified reporting with system context; requires a new explicit grant.
    Usage(crate::usage_settings::UsageOptions),
    /// Separate permission for 24-month monthly summaries.
    History(crate::usage_settings::AdditionalOptions),
    /// Separate permission to contribute to public monthly totals.
    Publication(crate::usage_settings::PublicationOptions),
    /// Separate permission for future cross-tool profile links.
    Profile(crate::usage_settings::ProfileOptions),
    #[command(about = tr!("Read the usage reporting notice and optionally enable it."))]
    Enable {
        /// Affirm consent to the displayed telemetry-v1 notice.
        #[arg(long, value_parser = [CONSENT_REVISION])]
        accept: Option<String>,
    },
    #[command(about = tr!("Inspect the effective usage reporting policy without sending data."))]
    Status,
    #[command(about = tr!("Preview queued reports without sending data."))]
    Preview,
    #[command(about = tr!("Stop usage reporting and discard unsent reports."))]
    Disable,
    #[command(about = tr!("Decline usage reporting."))]
    Decline,
    #[command(about = tr!("Request deletion of retained usage reports."))]
    Delete,
    #[command(about = tr!("Try sending one pending operation."))]
    Flush,
    #[command(about = tr!("Delete the previous identity before a separate new consent decision."))]
    Reset,
    #[command(about = tr!("Forget local authority without confirming remote deletion."))]
    Forget {
        #[arg(long, required = true)]
        acknowledge_unverified_deletion: bool,
    },
}

pub(crate) fn env(name: &str) -> Option<String> {
    std::env::var_os(name).map(|s| s.into_string().unwrap_or_else(|_| "invalid".into()))
}

fn path_env(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

pub(crate) fn cache_root() -> Option<PathBuf> {
    let root = if cfg!(target_os = "windows") {
        path_env("LOCALAPPDATA")?
    } else if cfg!(target_os = "macos") {
        path_env("HOME")?.join("Library/Caches")
    } else {
        path_env("XDG_CACHE_HOME").or_else(|| path_env("HOME").map(|p| p.join(".cache")))?
    };
    Some(root.join("palamedes"))
}

pub(crate) fn state_root(ci: bool) -> Option<PathBuf> {
    if let Some(root) = path_env("APP_TRACKING_STATE_DIR") {
        return root.is_absolute().then_some(root);
    }
    if ci {
        return None;
    }
    let root = if cfg!(target_os = "windows") {
        path_env("LOCALAPPDATA")?
    } else if cfg!(target_os = "macos") {
        path_env("HOME")?.join("Library/Application Support")
    } else {
        path_env("XDG_STATE_HOME").or_else(|| path_env("HOME").map(|p| p.join(".local/state")))?
    };
    root.is_absolute()
        .then(|| root.join("palamedes/app-tracking"))
}

pub(crate) fn ci() -> bool {
    [
        "CI",
        "GITHUB_ACTIONS",
        "GITLAB_CI",
        "BUILDKITE",
        "CIRCLECI",
        "JENKINS_URL",
        "TF_BUILD",
    ]
    .iter()
    .any(|name| {
        env(name).is_some_and(|v| !matches!(v.to_ascii_lowercase().as_str(), "" | "0" | "false"))
    })
}

fn configured(offline: bool) -> Option<(Client, Policy)> {
    let ci = ci();
    let root = state_root(ci)?;
    let policy = policy(offline);
    Some((Client::new(SERVICE_ORIGIN, root, "palamedes").ok()?, policy))
}

pub(crate) fn policy(offline: bool) -> Policy {
    let ci = ci();
    Policy {
        do_not_track: env("DO_NOT_TRACK").as_deref() == Some("1"),
        host_disabled: env("PALAMEDES_TELEMETRY").is_some_and(|s| s != "on"),
        telemetry: env("APP_TRACKING_TELEMETRY"),
        environment_consent: env("APP_TRACKING_CONSENT"),
        ci,
        ci_revision: env("APP_TRACKING_CI"),
        isolated_ci_state: ci && path_env("APP_TRACKING_STATE_DIR").is_some(),
        offline: offline
            || !RELEASE_NETWORK_ENABLED
            || env("PALAMEDES_OFFLINE").as_deref() == Some("1"),
    }
}

fn error(message: impl ToString) -> CliError {
    CliError::Telemetry {
        message: message.to_string(),
    }
}
fn output(text: &str) -> Result<(), CliError> {
    io::stdout()
        .lock()
        .write_all(text.as_bytes())
        .map_err(|_| error("Could not write telemetry output."))
}

pub fn execute(options: &Options, offline: bool) -> Result<u8, CliError> {
    match &options.command {
        Operation::Usage(options) => return crate::usage_settings::usage(options, offline),
        Operation::History(options) => return crate::usage_settings::history(options, offline),
        Operation::Publication(options) => {
            return crate::usage_settings::publication(options, offline);
        }
        Operation::Profile(options) => return crate::usage_settings::profile(options, offline),
        _ => {}
    }

    if let Operation::Enable { accept } = &options.command {
        output(DISCLOSURE)?;
        if accept.is_none() {
            return Ok(0);
        }
    }
    let (client, policy) = configured(offline).ok_or_else(|| error("A private state directory is required; CI needs an absolute, isolated APP_TRACKING_STATE_DIR."))?;
    match &options.command {
        Operation::Preview => output(&(client.preview(&policy).map_err(error)? + "\n"))?,
        operation => {
            if matches!(
                operation,
                Operation::Disable
                    | Operation::Decline
                    | Operation::Enable { .. }
                    | Operation::Delete
                    | Operation::Reset
            ) {
                crate::usage_settings::stop(
                    offline,
                    matches!(operation, Operation::Delete | Operation::Reset),
                )?;
            }
            let control = match operation {
                Operation::Enable { .. } => Some(Control::Enable),
                Operation::Disable => Some(Control::Withdraw),
                Operation::Decline => Some(Control::Decline),
                Operation::Delete => Some(Control::Delete),
                Operation::Reset => Some(Control::Reset),
                Operation::Forget { .. } => Some(Control::ForgetUnverified),
                Operation::Status
                | Operation::Flush
                | Operation::Preview
                | Operation::Usage(_)
                | Operation::History(_)
                | Operation::Profile(_)
                | Operation::Publication(_) => None,
            };
            if let Some(control) = control {
                client.control(control, &policy).map_err(error)?;
            }
            if matches!(
                operation,
                Operation::Delete | Operation::Reset | Operation::Flush
            ) {
                client
                    .run_in_background(
                        &policy,
                        None,
                        unknown_context,
                        matches!(operation, Operation::Flush),
                    )
                    .map_err(error)?;
            }
            let mut status = serde_json::to_value(client.status(&policy).map_err(error)?)?;
            status["unified"] = crate::usage_settings::snapshot(offline)?;
            output(&(serde_json::to_string_pretty(&status)? + "\n"))?;
        }
    }
    Ok(0)
}

pub fn record(
    category: &'static str,
    offline: bool,
    context: impl FnOnce() -> RepositoryContext + Send + 'static,
) {
    if crate::usage_settings::active(offline) {
        crate::usage_settings::record(category, offline, context);
        return;
    }
    let Some((client, policy)) = configured(offline) else {
        return;
    };
    // Advisory failures never change command output or exit status. All project
    // discovery stays inside the closure, after effective collection consent.
    let _ = client.run_in_background(
        &policy,
        Some(Invocation {
            command: category,
            tool_version: env!("CARGO_PKG_VERSION"),
        }),
        context,
        false,
    );
}

pub(crate) fn unknown_context() -> RepositoryContext {
    RepositoryContext {
        origin: Origin::Unavailable,
        package_json: None,
    }
}
pub(crate) fn project_context(explicit_config: Option<&Path>) -> RepositoryContext {
    let cwd = if let Some(config) = explicit_config {
        let Ok(config) = config.canonicalize() else {
            return unknown_context();
        };
        let Some(parent) = config.parent() else {
            return unknown_context();
        };
        parent.to_owned()
    } else {
        let Ok(cwd) = std::env::current_dir() else {
            return unknown_context();
        };
        cwd
    };
    let origin = git_origin(&cwd);
    let package_json = if matches!(origin, Origin::Absent) {
        cwd.ancestors()
            .find_map(|path| {
                let path = path.join("package.json");
                if !path.exists() {
                    return None;
                }
                Some(read_bounded(&path, 1_048_576))
            })
            .flatten()
    } else {
        None
    };
    RepositoryContext {
        origin,
        package_json,
    }
}
fn read_bounded(path: &Path, max: u64) -> Option<String> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > max {
        return None;
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A concurrently replaced package file must not block on a FIFO or
        // follow a foreign symlink while preparing advisory telemetry.
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    let file = options.open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut value = String::new();
    file.take(max + 1).read_to_string(&mut value).ok()?;
    (value.len() as u64 <= max).then_some(value)
}

fn git_origin(cwd: &Path) -> Origin {
    let mut checkout = false;
    for path in cwd.ancestors() {
        match path.join(".git").try_exists() {
            Ok(true) => {
                checkout = true;
                break;
            }
            Ok(false) => {}
            Err(_) => return Origin::Unavailable,
        }
    }
    if !checkout {
        return Origin::Absent;
    }
    // Raw local configuration only: no includes, URL rewrites, hooks, or network.
    let mut command = Command::new("git");
    command
        .args([
            "config",
            "--local",
            "--no-includes",
            "--null",
            "--get-all",
            "remote.origin.url",
        ])
        .current_dir(cwd)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for name in ["PATH", "SystemRoot"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    let Ok(mut child) = command.spawn() else {
        return Origin::Unavailable;
    };
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < Duration::from_millis(200) => {
                std::thread::sleep(Duration::from_millis(1))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Origin::Unavailable;
            }
        }
    };
    if status.code() == Some(1) {
        return Origin::Absent;
    }
    if !status.success() {
        return Origin::Unavailable;
    }
    let Some(stdout) = child.stdout.take() else {
        return Origin::Unavailable;
    };
    let mut bytes = Vec::new();
    if stdout.take(8193).read_to_end(&mut bytes).is_err() || bytes.len() > 8192 {
        return Origin::Unavailable;
    }
    let Ok(text) = String::from_utf8(bytes) else {
        return Origin::Unavailable;
    };
    let Some(value) = text.strip_suffix('\0') else {
        return Origin::Unavailable;
    };
    if value.contains('\0') || value.is_empty() {
        return Origin::Unavailable;
    }
    Origin::Present(value.to_owned())
}
