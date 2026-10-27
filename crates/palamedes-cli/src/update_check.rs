//! Advisory version delivery, independent of opt-in usage reporting.
use app_tracking::{Mode, Tool, UpdateClient};
use std::io::IsTerminal;
pub(crate) const SERVICE_ORIGIN: &str = "https://sebastian-app-tracking.b-cdn.net";
/// Source builds stay offline unless the owned endpoint passed build validation.
pub(crate) const RELEASE_NETWORK_ENABLED: bool = cfg!(palamedes_update_endpoint);
pub fn check(offline: bool) -> Option<String> {
    let disabled = !RELEASE_NETWORK_ENABLED
        || super::telemetry::env("DO_NOT_TRACK").as_deref() == Some("1")
        || super::telemetry::env("PALAMEDES_UPDATE_CHECK").as_deref() == Some("0");
    if disabled || offline || super::telemetry::env("PALAMEDES_OFFLINE").as_deref() == Some("1") {
        return None;
    }
    if !enabled_for_session(
        super::telemetry::env("PALAMEDES_UPDATE_CHECK").as_deref(),
        super::telemetry::ci(),
        std::io::stderr().is_terminal(),
    ) {
        return None;
    }
    let root = super::telemetry::cache_root()?;
    let tool = Tool::new("palamedes", env!("CARGO_PKG_VERSION"), "github", "stable").ok()?;
    let client = UpdateClient::new(SERVICE_ORIGIN, root.join("app-tracking-updates"), tool).ok()?;
    let update = client.check(Mode::Enabled).ok()??;
    Some(tr!(
        "pmds: Palamedes {latest} is available (installed {installed}). Update with your original package manager; for npm, run: npm install @palamedes/cli@latest",
        latest = update.latest_version,
        installed = env!("CARGO_PKG_VERSION")
    ))
}

fn enabled_for_session(setting: Option<&str>, ci: bool, interactive: bool) -> bool {
    match setting {
        Some("0") => false,
        Some("1") => true,
        _ => interactive && !ci,
    }
}

#[cfg(test)]
mod tests {
    use super::enabled_for_session;

    #[test]
    fn automatic_updates_are_interactive_and_local_with_an_explicit_override() {
        for ci in [false, true] {
            for interactive in [false, true] {
                assert_eq!(
                    enabled_for_session(None, ci, interactive),
                    interactive && !ci
                );
                assert_eq!(
                    enabled_for_session(Some("invalid"), ci, interactive),
                    interactive && !ci
                );
                assert!(!enabled_for_session(Some("0"), ci, interactive));
                assert!(enabled_for_session(Some("1"), ci, interactive));
            }
        }
    }
}
