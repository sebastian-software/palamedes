use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::{Command, Output};

fn run(profile: &Path, cwd: &Path, args: &[&str], settings: &[(&str, &str)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_pmds"));
    command
        .env_clear()
        .args(args)
        .current_dir(cwd)
        .env("PALAMEDES_UI_LOCALE", "en")
        .env(
            "PALAMEDES_UI_CATALOG_DIR",
            concat!(env!("OUT_DIR"), "/catalogs"),
        )
        .env("HOME", profile)
        .env("LOCALAPPDATA", profile)
        .env("XDG_STATE_HOME", profile)
        .env("APP_TRACKING_STATE_DIR", profile.join("state"))
        .env("PALAMEDES_OFFLINE", "1");
    for name in ["PATH", "SystemRoot"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    for (name, value) in settings {
        command.env(name, value);
    }
    command.output().expect("run isolated pmds fixture")
}
fn status(profile: &Path, cwd: &Path) -> Value {
    let output = run(profile, cwd, &["telemetry", "status"], &[]);
    assert!(output.status.success(), "{output:?}");
    serde_json::from_slice(&output.stdout).unwrap()
}
fn preview(profile: &Path, cwd: &Path) -> Value {
    let output = run(profile, cwd, &["telemetry", "preview"], &[]);
    assert!(output.status.success(), "{output:?}");
    serde_json::from_slice(&output.stdout).unwrap()
}
fn enable(profile: &Path, cwd: &Path) {
    let output = run(
        profile,
        cwd,
        &["telemetry", "enable", "--accept", "telemetry-v1"],
        &[],
    );
    assert!(output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("pseudonymous"));
}

#[test]
fn no_consent_or_notice_alone_creates_no_state() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    for args in [
        vec!["--help"],
        vec!["version"],
        vec!["telemetry", "status"],
        vec!["telemetry", "preview"],
        vec!["telemetry", "enable"],
        vec!["report"],
    ] {
        let output = run(profile.path(), project.path(), &args, &[]);
        if args == ["report"] {
            assert_eq!(output.status.code(), Some(1));
        } else {
            assert!(output.status.success(), "{output:?}");
        }
        assert_eq!(fs::read_dir(profile.path()).unwrap().count(), 0);
    }
}

#[test]
fn failed_commands_count_once_and_controls_never_count() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    enable(profile.path(), project.path());
    for command in ["extract", "lint", "audit", "report"] {
        let output = run(profile.path(), project.path(), &[command], &[]);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
    }
    let before = status(profile.path(), project.path());
    assert_eq!(before["unsent_invocations"], 4);
    assert!(before["installation_id"].is_null());
    for args in [
        vec!["version"],
        vec!["--help"],
        vec!["telemetry", "preview"],
        vec!["telemetry", "status"],
    ] {
        assert!(
            run(profile.path(), project.path(), &args, &[])
                .status
                .success()
        );
    }
    assert_eq!(
        status(profile.path(), project.path())["unsent_invocations"],
        4
    );
    let view = preview(profile.path(), project.path());
    let commands: std::collections::BTreeSet<_> = view["open_rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["command"].as_str().unwrap())
        .collect();
    assert_eq!(
        commands,
        std::collections::BTreeSet::from(["extract", "lint", "audit", "report"])
    );
    let text = serde_json::to_string(&view).unwrap();
    assert!(!text.contains("token"));
    assert!(!text.contains(project.path().to_str().unwrap()));
}

#[test]
fn withdrawal_and_do_not_track_override_environment_consent() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    enable(profile.path(), project.path());
    run(profile.path(), project.path(), &["report"], &[]);
    run(
        profile.path(),
        project.path(),
        &["report"],
        &[("DO_NOT_TRACK", "1")],
    );
    assert_eq!(
        status(profile.path(), project.path())["unsent_invocations"],
        0
    );
    assert!(
        run(
            profile.path(),
            project.path(),
            &["telemetry", "disable"],
            &[]
        )
        .status
        .success()
    );
    run(
        profile.path(),
        project.path(),
        &["report"],
        &[("APP_TRACKING_CONSENT", "telemetry-v1")],
    );
    let stopped = status(profile.path(), project.path());
    assert_eq!(stopped["decision"], "withdrawn");
    assert_eq!(stopped["unsent_invocations"], 0);
    let deleted = run(
        profile.path(),
        project.path(),
        &["telemetry", "delete"],
        &[],
    );
    assert!(deleted.status.success(), "{deleted:?}");
    assert_eq!(
        serde_json::from_slice::<Value>(&deleted.stdout).unwrap()["deletion"],
        "no_remote_identity"
    );
}

#[test]
fn ci_needs_its_separate_revision_even_with_a_local_grant() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    enable(profile.path(), project.path());
    run(
        profile.path(),
        project.path(),
        &["report"],
        &[("CI", "1"), ("APP_TRACKING_CONSENT", "telemetry-v1")],
    );
    let ci = run(
        profile.path(),
        project.path(),
        &["telemetry", "status"],
        &[("CI", "1")],
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&ci.stdout).unwrap()["unsent_invocations"],
        0
    );
    run(
        profile.path(),
        project.path(),
        &["report"],
        &[
            ("CI", "1"),
            ("APP_TRACKING_CONSENT", "telemetry-v1"),
            ("APP_TRACKING_CI", "telemetry-v1"),
        ],
    );
    let ci = run(
        profile.path(),
        project.path(),
        &["telemetry", "status"],
        &[
            ("CI", "1"),
            ("APP_TRACKING_CONSENT", "telemetry-v1"),
            ("APP_TRACKING_CI", "telemetry-v1"),
        ],
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&ci.stdout).unwrap()["unsent_invocations"],
        1
    );
    assert_eq!(
        status(profile.path(), project.path())["unsent_invocations"],
        0
    );
}

fn repository(path: &Path, origin: &str) {
    for args in [
        vec!["init", "--quiet"],
        vec!["config", "remote.origin.url", origin],
    ] {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(path)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
}

#[test]
fn catalog_tools_and_plugins_have_fixed_categories_and_merge_driver_is_excluded() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    enable(profile.path(), project.path());
    for args in [
        vec![
            "catalog",
            "merge",
            "left.po",
            "right.po",
            "--output",
            "out.po",
            "--source-locale",
            "en",
            "--format",
            "po",
        ],
        vec!["catalog", "convert", "missing.po", "--to", "fcl"],
        vec![
            "catalog", "compile", "--target", "js", "--output", "compiled",
        ],
        vec!["synthetic-private-plugin-name"],
    ] {
        let output = run(profile.path(), project.path(), &args, &[]);
        assert_eq!(
            output.status.code(),
            Some(if args[0] == "synthetic-private-plugin-name" {
                2
            } else {
                1
            }),
            "{output:?}"
        );
    }
    let view = preview(profile.path(), project.path());
    let categories: std::collections::BTreeSet<_> = view["open_rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["command"].as_str().unwrap())
        .collect();
    assert_eq!(
        categories,
        std::collections::BTreeSet::from([
            "catalogmerge",
            "catalogconvert",
            "catalogcompile",
            "plugin"
        ])
    );
    assert!(!view.to_string().contains("synthetic-private-plugin-name"));
    let driver = run(
        profile.path(),
        project.path(),
        &[
            "catalog",
            "merge-driver",
            "base.po",
            "current.po",
            "other.po",
            "out.po",
            "--path",
            "catalog.po",
            "--format",
            "po",
            "--source-locale",
            "en",
        ],
        &[],
    );
    assert_eq!(driver.status.code(), Some(1));
    let invalid = run(
        profile.path(),
        project.path(),
        &["report", "--invalid"],
        &[],
    );
    assert_eq!(invalid.status.code(), Some(2));
    assert_eq!(
        status(profile.path(), project.path())["unsent_invocations"],
        4
    );
}

#[test]
fn repository_identity_matches_clones_and_explicit_config_context() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let p1 = tempfile::tempdir().unwrap();
    let p2 = tempfile::tempdir().unwrap();
    repository(
        first.path(),
        "git@github.com:example-org/synthetic-project.git",
    );
    repository(
        second.path(),
        "https://github.com/example-org/synthetic-project",
    );
    fs::write(second.path().join("palamedes.yaml"), "invalid fixture").unwrap();
    enable(p1.path(), first.path());
    enable(p2.path(), second.path());
    run(p1.path(), first.path(), &["report"], &[]);
    run(
        p2.path(),
        first.path(),
        &[
            "report",
            "--config",
            second.path().join("palamedes.yaml").to_str().unwrap(),
        ],
        &[],
    );
    let a = preview(p1.path(), first.path());
    let b = preview(p2.path(), second.path());
    let expected =
        app_tracking::project::identify(true, || app_tracking::project::RepositoryContext {
            origin: app_tracking::project::Origin::Present(
                "https://github.com/example-org/synthetic-project".into(),
            ),
            package_json: None,
        })
        .unwrap();
    assert_eq!(a["open_rows"][0]["project_id"], expected.hash());
    assert_eq!(
        a["open_rows"][0]["project_id"],
        b["open_rows"][0]["project_id"]
    );
}
