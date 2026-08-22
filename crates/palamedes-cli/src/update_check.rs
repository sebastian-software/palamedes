//! Privacy-bounded, advisory CLI update checks.
//!
//! The production endpoint is a build-time contract. Release builds do not
//! perform a request until the release environment supplies an HTTPS
//! `PALAMEDES_UPDATE_ENDPOINT`; this keeps an undeployed endpoint from becoming
//! an implicit network call. ADR 027 owns the rollout and data-minimization
//! contract.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use semver::Version;
use serde::{Deserialize, Serialize};

const CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_RESPONSE_BYTES: u64 = 4 * 1024;

/// A due check that runs alongside the command and is joined before process
/// exit so a successful response can produce its advisory stderr notice.
#[derive(Default)]
pub struct UpdateCheck {
    worker: Option<JoinHandle<Option<String>>>,
}

impl UpdateCheck {
    pub fn start() -> Self {
        let Some(settings) = Settings::from_process() else {
            return Self::default();
        };

        let worker = thread::Builder::new()
            .name("pmds-update-check".to_owned())
            .spawn(move || {
                let cache = PlatformCache::new(settings.cache_file);
                run_due_check(
                    &SystemClock,
                    &cache,
                    &HttpTransport::new(settings.endpoint),
                    settings.payload,
                )
            })
            .ok();

        Self { worker }
    }

    /// Returns no notice on every cache, clock, thread, transport, response, or
    /// semver failure. Update checks never change command success.
    pub fn finish(self) -> Option<String> {
        self.worker?.join().ok().flatten()
    }
}

#[derive(Debug)]
struct Settings {
    endpoint: &'static str,
    cache_file: PathBuf,
    payload: UpdatePayload,
}

impl Settings {
    fn from_process() -> Option<Self> {
        let endpoint = option_env!("PALAMEDES_UPDATE_ENDPOINT")?;
        Self::from_environment(endpoint, |name| std::env::var_os(name))
    }

    fn from_environment(
        endpoint: &'static str,
        environment: impl Fn(&str) -> Option<OsString>,
    ) -> Option<Self> {
        if !endpoint.starts_with("https://")
            || environment("DO_NOT_TRACK").as_deref() == Some("1".as_ref())
            || environment("PALAMEDES_UPDATE_CHECK").as_deref() == Some("0".as_ref())
        {
            return None;
        }

        let cache_file = platform_cache_file(current_platform(), &environment)?;
        let ci = is_ci(&environment);
        Some(Self {
            endpoint,
            cache_file,
            payload: UpdatePayload {
                version: env!("CARGO_PKG_VERSION").to_owned(),
                os: std::env::consts::OS.to_owned(),
                arch: std::env::consts::ARCH.to_owned(),
                ci,
            },
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
struct UpdatePayload {
    version: String,
    os: String,
    arch: String,
    ci: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResponse {
    latest_version: String,
}

trait Clock {
    fn now_secs(&self) -> Option<u64>;
}

struct SystemClock;

impl Clock for SystemClock {
    fn now_secs(&self) -> Option<u64> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_secs())
    }
}

trait CheckCache {
    /// Atomically records a due attempt before network I/O. A failed or offline
    /// endpoint is therefore retried on the next daily window, not every run.
    fn claim_due(&self, now_secs: u64) -> bool;
}

struct PlatformCache {
    file: PathBuf,
}

impl PlatformCache {
    fn new(file: PathBuf) -> Self {
        Self { file }
    }
}

impl CheckCache for PlatformCache {
    fn claim_due(&self, now_secs: u64) -> bool {
        let Some(parent) = self.file.parent() else {
            return false;
        };
        if fs::create_dir_all(parent).is_err() {
            return false;
        }

        let lock_path = self.file.with_extension("lock");
        let Ok(()) = fs::create_dir(&lock_path) else {
            return false;
        };
        let _lock = DirectoryLock(&lock_path);

        if let Ok(value) = fs::read_to_string(&self.file) {
            if let Ok(previous) = value.trim().parse::<u64>() {
                if now_secs.saturating_sub(previous) < CHECK_INTERVAL_SECS || previous > now_secs {
                    return false;
                }
            }
        }

        fs::write(&self.file, format!("{now_secs}\n")).is_ok()
    }
}

struct DirectoryLock<'a>(&'a Path);

impl Drop for DirectoryLock<'_> {
    fn drop(&mut self) {
        let _ = fs::remove_dir(self.0);
    }
}

trait Transport {
    fn latest_version(&self, payload: &UpdatePayload) -> Option<String>;
}

struct HttpTransport {
    endpoint: &'static str,
}

impl HttpTransport {
    fn new(endpoint: &'static str) -> Self {
        Self { endpoint }
    }
}

impl Transport for HttpTransport {
    fn latest_version(&self, payload: &UpdatePayload) -> Option<String> {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .https_only(true)
            .max_redirects(0)
            // Do not add library or binary identity beyond the four documented
            // JSON fields. Protocol-required headers remain transport details.
            .user_agent("")
            .accept("")
            .accept_encoding("")
            .build();
        let agent = ureq::Agent::new_with_config(config);
        let mut response = agent.post(self.endpoint).send_json(payload).ok()?;
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_RESPONSE_BYTES)
            .read_to_string()
            .ok()?;
        serde_json::from_str::<UpdateResponse>(&body)
            .ok()
            .map(|response| response.latest_version)
    }
}

fn run_due_check(
    clock: &dyn Clock,
    cache: &dyn CheckCache,
    transport: &dyn Transport,
    payload: UpdatePayload,
) -> Option<String> {
    let now_secs = clock.now_secs()?;
    if !cache.claim_due(now_secs) {
        return None;
    }

    let latest = transport.latest_version(&payload)?;
    update_notice(&payload.version, &latest)
}

fn update_notice(current: &str, latest: &str) -> Option<String> {
    let current = Version::parse(current).ok()?;
    let latest = Version::parse(latest).ok()?;
    (latest > current)
        .then(|| format!("A new version of palamedes is available: {current} → {latest}"))
}

#[derive(Clone, Copy)]
enum Platform {
    Linux,
    MacOs,
    Windows,
    Other,
}

fn current_platform() -> Platform {
    if cfg!(target_os = "linux") {
        Platform::Linux
    } else if cfg!(target_os = "macos") {
        Platform::MacOs
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Other
    }
}

fn platform_cache_file(
    platform: Platform,
    environment: impl Fn(&str) -> Option<OsString>,
) -> Option<PathBuf> {
    let root = match platform {
        Platform::Linux => environment("XDG_CACHE_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                environment("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".cache"))
            })?,
        Platform::MacOs => environment("HOME")
            .map(PathBuf::from)?
            .join("Library")
            .join("Caches"),
        Platform::Windows => environment("LOCALAPPDATA").map(PathBuf::from)?,
        Platform::Other => return None,
    };

    Some(root.join("palamedes").join("update-check-v1"))
}

fn is_ci(environment: impl Fn(&str) -> Option<OsString>) -> bool {
    const CI_VARIABLES: &[&str] = &[
        "CI",
        "GITHUB_ACTIONS",
        "GITLAB_CI",
        "BUILDKITE",
        "CIRCLECI",
        "JENKINS_URL",
        "TF_BUILD",
    ];
    CI_VARIABLES.iter().any(|name| {
        environment(name).is_some_and(|value| {
            let normalized = value.to_string_lossy().to_ascii_lowercase();
            !matches!(normalized.as_str(), "" | "0" | "false")
        })
    })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};

    use super::*;

    struct FixedClock(Option<u64>);

    impl Clock for FixedClock {
        fn now_secs(&self) -> Option<u64> {
            self.0
        }
    }

    #[derive(Default)]
    struct RecordingCache {
        claims: AtomicUsize,
        due: bool,
    }

    impl CheckCache for RecordingCache {
        fn claim_due(&self, _now_secs: u64) -> bool {
            self.claims.fetch_add(1, Ordering::SeqCst);
            self.due
        }
    }

    struct RecordingTransport {
        calls: AtomicUsize,
        payload: Mutex<Option<UpdatePayload>>,
        latest: Option<String>,
    }

    impl Transport for RecordingTransport {
        fn latest_version(&self, payload: &UpdatePayload) -> Option<String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.payload.lock().expect("payload lock") = Some(payload.clone());
            self.latest.clone()
        }
    }

    fn payload(version: &str) -> UpdatePayload {
        UpdatePayload {
            version: version.to_owned(),
            os: "linux".to_owned(),
            arch: "x86_64".to_owned(),
            ci: false,
        }
    }

    #[test]
    fn sends_only_the_documented_payload_and_reports_newer_semver() {
        let cache = RecordingCache {
            due: true,
            ..RecordingCache::default()
        };
        let transport = RecordingTransport {
            calls: AtomicUsize::new(0),
            payload: Mutex::new(None),
            latest: Some("1.4.0".to_owned()),
        };

        let notice = run_due_check(&FixedClock(Some(100)), &cache, &transport, payload("1.2.3"));

        assert_eq!(
            notice.as_deref(),
            Some("A new version of palamedes is available: 1.2.3 → 1.4.0")
        );
        assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
        let sent = transport.payload.lock().expect("payload lock").clone();
        assert_eq!(sent, Some(payload("1.2.3")));
        assert_eq!(
            serde_json::to_value(sent.expect("sent payload")).expect("serialize payload"),
            serde_json::json!({
                "version": "1.2.3",
                "os": "linux",
                "arch": "x86_64",
                "ci": false
            })
        );
    }

    #[test]
    fn failures_old_versions_and_invalid_versions_are_silent() {
        for latest in [None, Some("1.2.3"), Some("1.1.9"), Some("not-semver")] {
            let cache = RecordingCache {
                due: true,
                ..RecordingCache::default()
            };
            let transport = RecordingTransport {
                calls: AtomicUsize::new(0),
                payload: Mutex::new(None),
                latest: latest.map(str::to_owned),
            };
            assert!(
                run_due_check(&FixedClock(Some(100)), &cache, &transport, payload("1.2.3"))
                    .is_none()
            );
        }

        assert!(update_notice("invalid", "2.0.0").is_none());
        assert_eq!(
            update_notice("2.0.0-beta.1", "2.0.0"),
            Some("A new version of palamedes is available: 2.0.0-beta.1 → 2.0.0".to_owned())
        );
    }

    #[test]
    fn a_missing_clock_or_fresh_cache_never_reaches_transport() {
        for (clock, due) in [(None, true), (Some(100), false)] {
            let cache = RecordingCache {
                due,
                ..RecordingCache::default()
            };
            let transport = RecordingTransport {
                calls: AtomicUsize::new(0),
                payload: Mutex::new(None),
                latest: Some("2.0.0".to_owned()),
            };
            assert!(
                run_due_check(&FixedClock(clock), &cache, &transport, payload("1.0.0")).is_none()
            );
            assert_eq!(transport.calls.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn cache_claims_once_per_24_hours_and_recovers_corrupt_content() {
        let temp = tempfile::tempdir().expect("temp dir");
        let file = temp.path().join("cache").join("update-check-v1");
        let cache = PlatformCache::new(file.clone());

        assert!(cache.claim_due(10));
        assert!(!cache.claim_due(10 + CHECK_INTERVAL_SECS - 1));
        assert!(cache.claim_due(10 + CHECK_INTERVAL_SECS));
        assert!(!cache.claim_due(1));

        fs::write(&file, "broken\n").expect("corrupt cache");
        assert!(cache.claim_due(20));
    }

    #[test]
    fn concurrent_process_shaped_claims_allow_one_due_attempt() {
        let temp = tempfile::tempdir().expect("temp dir");
        let file = Arc::new(temp.path().join("palamedes").join("update-check-v1"));
        let barrier = Arc::new(Barrier::new(16));
        let winners = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();

        for _ in 0..16 {
            let file = Arc::clone(&file);
            let barrier = Arc::clone(&barrier);
            let winners = Arc::clone(&winners);
            workers.push(thread::spawn(move || {
                barrier.wait();
                if PlatformCache::new((*file).clone()).claim_due(100) {
                    winners.fetch_add(1, Ordering::SeqCst);
                }
            }));
        }
        for worker in workers {
            worker.join().expect("cache worker");
        }

        assert_eq!(winners.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn cache_write_failures_disable_the_request_instead_of_losing_the_rate_limit() {
        let temp = tempfile::tempdir().expect("temp dir");
        let parent_file = temp.path().join("not-a-directory");
        fs::write(&parent_file, "occupied").expect("parent fixture");
        let cache = PlatformCache::new(parent_file.join("update-check-v1"));
        assert!(!cache.claim_due(100));
    }

    fn environment(values: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let values = values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), OsString::from(value)))
            .collect::<BTreeMap<_, _>>();
        move |name| values.get(name).cloned()
    }

    #[test]
    fn opt_outs_and_non_https_endpoints_disable_all_work() {
        for (endpoint, values) in [
            (
                "https://version.palamedes.dev/check",
                vec![("HOME", "/tmp/home"), ("DO_NOT_TRACK", "1")],
            ),
            (
                "https://version.palamedes.dev/check",
                vec![("HOME", "/tmp/home"), ("PALAMEDES_UPDATE_CHECK", "0")],
            ),
            (
                "http://version.palamedes.dev/check",
                vec![("HOME", "/tmp/home")],
            ),
        ] {
            assert!(Settings::from_environment(endpoint, environment(&values)).is_none());
        }
    }

    #[test]
    fn platform_cache_paths_and_ci_detection_are_deterministic() {
        assert_eq!(
            platform_cache_file(
                Platform::Linux,
                environment(&[("XDG_CACHE_HOME", "/xdg"), ("HOME", "/home/alex")])
            ),
            Some(PathBuf::from("/xdg/palamedes/update-check-v1"))
        );
        assert_eq!(
            platform_cache_file(Platform::Linux, environment(&[("HOME", "/home/alex")])),
            Some(PathBuf::from("/home/alex/.cache/palamedes/update-check-v1"))
        );
        assert_eq!(
            platform_cache_file(Platform::MacOs, environment(&[("HOME", "/Users/alex")])),
            Some(PathBuf::from(
                "/Users/alex/Library/Caches/palamedes/update-check-v1"
            ))
        );
        assert_eq!(
            platform_cache_file(
                Platform::Windows,
                environment(&[("LOCALAPPDATA", r"C:\Users\alex\AppData\Local")])
            ),
            Some(PathBuf::from(
                r"C:\Users\alex\AppData\Local/palamedes/update-check-v1"
            ))
        );
        assert_eq!(platform_cache_file(Platform::Other, environment(&[])), None);

        assert!(is_ci(environment(&[("GITHUB_ACTIONS", "true")])));
        assert!(!is_ci(environment(&[("CI", "false")])));
        assert!(!is_ci(environment(&[])));
    }
}
