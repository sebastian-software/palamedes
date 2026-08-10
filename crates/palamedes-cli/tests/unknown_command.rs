use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn a_mistyped_builtin_is_a_usage_error_with_a_suggestion() {
    let fixture = fixture_dir("unknown-command-typo");
    fs::create_dir_all(&fixture).expect("create fixture");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .arg("lnit")
        .current_dir(&fixture)
        .output()
        .expect("run pmds");

    assert_eq!(result.status.code(), Some(2), "{result:?}");
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("Unknown command \"lnit\""), "{stderr}");
    assert!(stderr.contains("Did you mean \"lint\"?"), "{stderr}");
    assert!(!stderr.contains("PLUGIN_CONFIG_FAILED"), "{stderr}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

/// A namespace that a config could plausibly declare keeps reporting the
/// config failure: the user named the file, so its problem is the answer.
#[test]
fn an_explicit_config_still_reports_the_config_failure() {
    let fixture = fixture_dir("unknown-command-explicit-config");
    fs::create_dir_all(&fixture).expect("create fixture");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args([
            "acme",
            "inspect",
            "--config",
            fixture
                .join("palamedes.yaml")
                .to_str()
                .expect("config path"),
        ])
        .current_dir(&fixture)
        .output()
        .expect("run pmds");

    assert_eq!(result.status.code(), Some(1), "{result:?}");
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("PLUGIN_CONFIG_FAILED"), "{stderr}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

/// A config that exists but cannot be read is a config problem, not a spelling
/// one: the namespace may well be declared in the file once it parses.
#[test]
fn an_unreadable_config_still_reports_the_config_failure() {
    let fixture = fixture_dir("unknown-command-invalid-config");
    fs::create_dir_all(&fixture).expect("create fixture");
    fs::write(fixture.join("palamedes.yaml"), "locales: []\n").expect("write invalid config");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args(["acme", "inspect"])
        .current_dir(&fixture)
        .output()
        .expect("run pmds");

    assert_eq!(result.status.code(), Some(1), "{result:?}");
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("PLUGIN_CONFIG_FAILED"), "{stderr}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

/// With a config in hand the namespace is what fails, whether or not a command
/// token followed it.
#[test]
fn a_bare_namespace_reports_the_unknown_namespace_when_a_config_exists() {
    let fixture = fixture_dir("unknown-command-with-config");
    fs::create_dir_all(&fixture).expect("create fixture");
    fs::write(
        fixture.join("palamedes.yaml"),
        "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}/messages\n    include: [src]\n",
    )
    .expect("write config");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .arg("lnit")
        .current_dir(&fixture)
        .output()
        .expect("run pmds");

    assert_eq!(result.status.code(), Some(2), "{result:?}");
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("PLUGIN_NAMESPACE_UNKNOWN"), "{stderr}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

fn fixture_dir(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "palamedes-cli-{name}-{}-{stamp}",
        std::process::id()
    ))
}
