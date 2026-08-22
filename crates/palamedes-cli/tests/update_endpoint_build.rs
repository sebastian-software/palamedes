// The production module also exposes build-script wiring; this integration
// test imports it only to exercise the shared validation decision directly.
#[allow(dead_code)]
#[path = "../build_support/update_endpoint.rs"]
mod update_endpoint;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use update_endpoint::{validate, UPDATE_ENDPOINT_ENV};

const VALID_ENDPOINT: &str = "https://version.palamedes.dev/check";

#[test]
fn build_contract_accepts_only_the_owned_https_route() {
    assert_eq!(validate(VALID_ENDPOINT), Ok(()));

    for endpoint in [
        "",
        "http://version.palamedes.dev/check",
        "https://",
        "https://version.palamedes.dev",
        "https://version.palamedes.dev/",
        "https://version.palamedes.dev/other",
        "https://user@version.palamedes.dev/check",
        "https://version.palamedes.dev:443/check",
        "https://version.palamedes.dev/check?channel=stable",
        "https://version.palamedes.dev/check#latest",
        "https://updates.example/check",
        " https://version.palamedes.dev/check",
    ] {
        assert!(validate(endpoint).is_err(), "accepted {endpoint:?}");
    }
}

#[test]
fn cargo_build_fails_before_emitting_a_binary_for_a_malformed_endpoint() {
    let target = tempfile::tempdir().expect("temporary Cargo target");
    let invalid = build_fixture(target.path(), Some("https://"));
    assert!(
        !invalid.status.success(),
        "invalid endpoint built: {invalid:?}"
    );
    assert!(
        String::from_utf8_lossy(&invalid.stderr).contains("invalid PALAMEDES_UPDATE_ENDPOINT"),
        "unexpected build failure: {invalid:?}"
    );
    assert!(
        !fixture_binary(target.path()).exists(),
        "a rejected endpoint must not emit a binary"
    );

    let valid = build_fixture(target.path(), Some(VALID_ENDPOINT));
    assert!(valid.status.success(), "valid endpoint failed: {valid:?}");
    assert!(fixture_binary(target.path()).is_file());

    let disabled = build_fixture(target.path(), None);
    assert!(
        disabled.status.success(),
        "disabled build failed: {disabled:?}"
    );
}

fn build_fixture(target: &Path, endpoint: Option<&str>) -> Output {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/update-endpoint-build/Cargo.toml");
    let mut command = Command::new(env!("CARGO"));
    command
        .args(["build", "--locked", "--offline", "--manifest-path"])
        .arg(manifest)
        .arg("--target-dir")
        .arg(target);
    if let Some(endpoint) = endpoint {
        command.env(UPDATE_ENDPOINT_ENV, endpoint);
    } else {
        command.env_remove(UPDATE_ENDPOINT_ENV);
    }
    command.output().expect("run fixture Cargo build")
}

fn fixture_binary(target: &Path) -> PathBuf {
    target.join("debug").join(format!(
        "update-endpoint-build-fixture{}",
        std::env::consts::EXE_SUFFIX
    ))
}
