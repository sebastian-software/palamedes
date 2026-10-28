//! Explicit settings for the unified client. Ordinary commands never prompt.
use crate::{error::CliError, telemetry, update_check::SERVICE_ORIGIN};
use app_tracking::client::{
    Client, HISTORY_CONSENT_REVISION, HISTORY_NOTICE, PROFILE_CONSENT_REVISION, PROFILE_NOTICE,
    PUBLIC_USAGE_CONSENT_REVISION, PUBLIC_USAGE_NOTICE,
};
use app_tracking::telemetry::{Control, Policy};
use clap::{Args, Subcommand};
use std::io::{self, Write};
use std::path::PathBuf;

const USAGE_REVISION: &str = "palamedes-events-v1";
const USAGE_NOTICE: &str = include_str!("../usage-notice.txt");

#[derive(Debug, Args)]
pub struct UsageOptions {
    #[command(subcommand)]
    command: Usage,
}
#[derive(Debug, Subcommand)]
enum Usage {
    /// Read the complete notice; --accept records a fresh grant.
    Enable {
        #[arg(long, value_parser = [USAGE_REVISION])]
        accept: Option<String>,
    },
    /// Inspect all unified permissions locally, without sending data.
    Status,
    /// Preview queued unified payloads locally, without sending data.
    Preview,
    /// Stop unified reporting and withdraw additional permissions.
    Disable,
    /// Stop and request deletion of this tool's unified reports and links.
    Delete,
    /// Schedule one ordinary operation and retry additional permissions.
    Sync,
}
#[derive(Debug, Args)]
pub struct AdditionalOptions {
    #[command(subcommand)]
    command: History,
}
#[derive(Debug, Subcommand)]
enum History {
    /// Read the notice; --accept records separate monthly-history consent.
    Enable {
        #[arg(long, value_parser = [HISTORY_CONSENT_REVISION])]
        accept: Option<String>,
    },
    /// Withdraw only monthly-history permission, preserving ordinary reporting.
    Disable,
    /// Inspect the local choice and acknowledgement status, without a request.
    Status,
    /// Retry the pending permission, subject to offline settings.
    Sync,
}
#[derive(Debug, Args)]
pub struct PublicationOptions {
    #[command(subcommand)]
    command: Publication,
}
#[derive(Debug, Subcommand)]
enum Publication {
    /// Read the notice; --accept records separate publication consent.
    Enable {
        #[arg(long, value_parser = [PUBLIC_USAGE_CONSENT_REVISION])]
        accept: Option<String>,
    },
    /// Withdraw only publication permission, preserving ordinary reporting.
    Disable,
    /// Inspect the local choice and acknowledgement status, without a request.
    Status,
    /// Retry the pending permission, subject to offline settings.
    Sync,
}
#[derive(Debug, Args)]
pub struct ProfileOptions {
    #[command(subcommand)]
    command: Profile,
}
#[derive(Debug, Subcommand)]
enum Profile {
    /// Read the notice; --accept records separate linking consent for this tool.
    Enable {
        #[arg(long, value_parser = [PROFILE_CONSENT_REVISION])]
        accept: Option<String>,
    },
    /// Unlink only this tool, preserving ordinary reporting and other tools.
    Disable,
    /// Inspect local linking and shared reset status, without a request.
    Status,
    /// Retry pending unlink, link, or shared reset, subject to offline settings.
    Sync,
    /// Remove all shared links; does not delete independent usage reports.
    Reset {
        #[arg(long, required = true)]
        all_tools: bool,
    },
}
fn error(value: impl ToString) -> CliError {
    CliError::Telemetry {
        message: value.to_string(),
    }
}
fn output(value: &str) -> Result<(), CliError> {
    writeln!(io::stdout().lock(), "{value}").map_err(error)
}
fn json(value: &impl serde::Serialize) -> Result<(), CliError> {
    output(&serde_json::to_string_pretty(value).map_err(error)?)
}
fn shared_root() -> Option<PathBuf> {
    let path = |name: &str| {
        std::env::var_os(name)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    let root = if cfg!(target_os = "windows") {
        path("LOCALAPPDATA")?
    } else if cfg!(target_os = "macos") {
        path("HOME")?.join("Library/Application Support")
    } else {
        path("XDG_STATE_HOME").or_else(|| path("HOME").map(|p| p.join(".local/state")))?
    };
    root.is_absolute()
        .then(|| root.join("sebastian-software/app-tracking"))
}
fn configured(offline: bool) -> Result<Client, CliError> {
    let policy = telemetry::policy(offline);
    let root = telemetry::state_root(policy.ci).ok_or_else(|| {
        error("A private absolute state directory is required; CI needs isolated state.")
    })?;
    let mut client =
        Client::registered(SERVICE_ORIGIN, root, "palamedes", env!("CARGO_PKG_VERSION"))
            .map_err(error)?
            .with_policy(policy);
    if let Some(root) = shared_root() {
        client = client.with_shared_profile(root);
    }
    Ok(client)
}
pub(crate) fn snapshot(offline: bool) -> Result<serde_json::Value, CliError> {
    let client = configured(offline)?;
    Ok(serde_json::json!({
        "usage": client.status().map_err(error)?,
        "history": client.history_status().map_err(error)?,
        "publication": client.public_usage_status().map_err(error)?,
        "profile": client.profile_status().map_err(error)?,
        "profile_reset_pending": client.profile_reset_pending().map_err(error)?
    }))
}
fn status(client: &Client) -> Result<(), CliError> {
    json(
        &serde_json::json!({"usage":client.status().map_err(error)?, "history":client.history_status().map_err(error)?, "publication":client.public_usage_status().map_err(error)?,"profile":client.profile_status().map_err(error)?,"profile_reset_pending":client.profile_reset_pending().map_err(error)?}),
    )
}
fn sync(client: &Client) -> Result<(), CliError> {
    // No invented invocation for registration: additional choices can remain
    // pending until a real ordinary batch has registered this installation.
    client.sync_profile_reset().map_err(error)?;
    client.sync_history_permission().map_err(error)?;
    client.sync_public_usage_permission().map_err(error)?;
    client.sync_profile_linking().map_err(error)?;
    client.flush_in_background().map_err(error)?;
    Ok(())
}
pub fn usage(options: &UsageOptions, offline: bool) -> Result<u8, CliError> {
    if let Usage::Enable { accept } = &options.command {
        output(USAGE_NOTICE)?;
        if accept.is_none() {
            return Ok(0);
        }
    }
    let client = configured(offline)?;
    match options.command {
        Usage::Enable { .. } => {
            // Preserve old authority for inspection/deletion; do not copy its
            // grant or send the same invocation through two protocols.
            let policy: Policy = telemetry::policy(offline);
            let root =
                telemetry::state_root(policy.ci).ok_or_else(|| error("Missing private state."))?;
            app_tracking::telemetry::Client::new(SERVICE_ORIGIN, root, "palamedes")
                .map_err(error)?
                .control(Control::Withdraw, &policy)
                .map_err(error)?;
            client.set_disabled(false).map_err(error)?;
            client.set_opt_in(true).map_err(error)?;
        }
        Usage::Disable => {
            client.set_opt_in(false).map_err(error)?;
            sync(&client)?;
        }
        Usage::Delete => {
            client.delete().map_err(error)?;
            client.flush_in_background().map_err(error)?;
        }
        Usage::Sync => sync(&client)?,
        Usage::Preview => {
            output(&client.preview().map_err(error)?)?;
            return Ok(0);
        }
        Usage::Status => {}
    }
    status(&client)?;
    Ok(0)
}
pub fn history(options: &AdditionalOptions, offline: bool) -> Result<u8, CliError> {
    if let History::Enable { accept } = &options.command {
        output(HISTORY_NOTICE)?;
        output(
            "Enable: pmds telemetry history enable --accept monthly-history-v1\nWithdraw: pmds telemetry history disable\nInspect/retry: pmds telemetry history status / sync\nRequires a separate pmds telemetry usage enable grant.",
        )?;
        if accept.is_none() {
            return Ok(0);
        }
    }
    let client = configured(offline)?;
    match options.command {
        History::Enable { .. } => {
            client.set_history_opt_in(true).map_err(error)?;
            client.sync_history_permission().map_err(error)?;
        }
        History::Disable => {
            client.set_history_opt_in(false).map_err(error)?;
            client.sync_history_permission().map_err(error)?;
            client.sync_public_usage_permission().map_err(error)?;
        }
        History::Sync => {
            client.sync_history_permission().map_err(error)?;
        }
        History::Status => {}
    }
    json(&client.history_status().map_err(error)?)?;
    Ok(0)
}
pub fn publication(options: &PublicationOptions, offline: bool) -> Result<u8, CliError> {
    if let Publication::Enable { accept } = &options.command {
        output(PUBLIC_USAGE_NOTICE)?;
        output(
            "Enable: pmds telemetry publication enable --accept public-usage-v1\nWithdraw: pmds telemetry publication disable\nInspect/retry: pmds telemetry publication status / sync\nRequires separate ordinary usage and monthly-history grants. Public figures can be copied by others.",
        )?;
        if accept.is_none() {
            return Ok(0);
        }
    }
    let client = configured(offline)?;
    match options.command {
        Publication::Enable { .. } => {
            client.set_public_usage_opt_in(true).map_err(error)?;
            client.sync_public_usage_permission().map_err(error)?;
        }
        Publication::Disable => {
            client.set_public_usage_opt_in(false).map_err(error)?;
            client.sync_public_usage_permission().map_err(error)?;
        }
        Publication::Sync => {
            client.sync_public_usage_permission().map_err(error)?;
        }
        Publication::Status => {}
    }
    json(&client.public_usage_status().map_err(error)?)?;
    Ok(0)
}
pub fn profile(options: &ProfileOptions, offline: bool) -> Result<u8, CliError> {
    if let Profile::Enable { accept } = &options.command {
        output(PROFILE_NOTICE)?;
        output(
            "Enable: pmds telemetry profile enable --accept profile-linking-v1\nUnlink: pmds telemetry profile disable\nReset all links: pmds telemetry profile reset --all-tools\nInspect/retry: pmds telemetry profile status / sync\nRequires a separate pmds telemetry usage enable grant. CI cannot link profiles.",
        )?;
        if accept.is_none() {
            return Ok(0);
        }
    }
    let client = configured(offline)?;
    match options.command {
        Profile::Enable { .. } => {
            client.set_profile_linking(true).map_err(error)?;
            client.sync_profile_linking().map_err(error)?;
        }
        Profile::Disable => {
            client.set_profile_linking(false).map_err(error)?;
            client.sync_profile_linking().map_err(error)?;
        }
        Profile::Reset { .. } => {
            client.request_profile_reset().map_err(error)?;
            client.sync_profile_reset().map_err(error)?;
        }
        Profile::Sync => {
            client.sync_profile_reset().map_err(error)?;
            client.sync_profile_linking().map_err(error)?;
        }
        Profile::Status => {}
    }
    json(
        &serde_json::json!({"linking": client.profile_status().map_err(error)?, "reset_pending": client.profile_reset_pending().map_err(error)?}),
    )?;
    Ok(0)
}
/// The top-level stop/delete controls apply to both streams. Old status and
/// preview remain available; unified status explicitly includes all new scopes.
pub fn stop(offline: bool, delete: bool) -> Result<(), CliError> {
    let client = configured(offline)?;
    if matches!(
        client.status().map_err(error)?.decision,
        app_tracking::client::OptInDecision::Undecided
    ) {
        return Ok(());
    }
    if delete {
        client.delete().map_err(error)?;
        client.flush_in_background().map_err(error)?;
    } else {
        client.set_opt_in(false).map_err(error)?;
        client.sync_history_permission().map_err(error)?;
        client.sync_public_usage_permission().map_err(error)?;
        client.sync_profile_linking().map_err(error)?;
    }
    Ok(())
}
pub fn active(offline: bool) -> bool {
    configured(offline)
        .ok()
        .and_then(|c| c.status().ok())
        .is_some_and(|s| s.collect_opt_in || s.deletion_pending)
}
pub fn record(
    category: &'static str,
    offline: bool,
    context: impl FnOnce() -> app_tracking::project::RepositoryContext + Send + 'static,
) {
    let Ok(client) = configured(offline) else {
        return;
    };
    let client = client.with_project_context(context);
    let _ = client.record("cli.invocation", || {
        [("command".into(), category.into())].into()
    });
    let _ = client.flush_in_background();
}
pub fn worker_entry() -> Option<u8> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref()
        != Some(std::ffi::OsStr::new(
            app_tracking::client::BACKGROUND_WORKER_ARGUMENT,
        ))
    {
        return None;
    }
    let success = args
        .next()
        .and_then(|v| v.into_string().ok())
        .filter(|_| args.next().is_none())
        .is_some_and(|nonce| {
            configured(false).is_ok_and(|client| client.run_background_worker(&nonce).is_ok())
        });
    Some(u8::from(!success))
}
