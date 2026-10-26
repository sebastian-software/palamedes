//! Advisory version delivery, independent of opt-in usage reporting.
use app_tracking::{Mode, Tool, UpdateClient};
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
