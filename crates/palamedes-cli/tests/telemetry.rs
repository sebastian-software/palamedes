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
fn internal_worker_never_enters_a_command_or_creates_reporting_state() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let output = run(
        profile.path(),
        project.path(),
        &["--app-tracking-worker-v1", &"0".repeat(64)],
        &[],
    );
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert!(output.stderr.is_empty());
    assert_eq!(fs::read_dir(profile.path()).unwrap().count(), 0);
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
fn watch_counts_on_entry_and_never_counts_rebuilds_or_termination() {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    fs::write(project.path().join("palamedes.yaml"), "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n").unwrap();
    fs::create_dir(project.path().join("app")).unwrap();
    let source = project.path().join("app/main.ts");
    fs::write(
        &source,
        "import {t} from '@palamedes/core/macro'; export function title() { return t`First`; }\n",
    )
    .unwrap();
    enable(profile.path(), project.path());
    let mut command = Command::new(env!("CARGO_BIN_EXE_pmds"));
    command
        .args(["extract", "--watch"])
        .current_dir(project.path())
        .env_clear()
        .env("PALAMEDES_UI_LOCALE", "en")
        .env(
            "PALAMEDES_UI_CATALOG_DIR",
            concat!(env!("OUT_DIR"), "/catalogs"),
        )
        .env("APP_TRACKING_STATE_DIR", profile.path().join("state"))
        .env("PALAMEDES_OFFLINE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            fs::File::create(profile.path().join("watch.stdout")).unwrap(),
        ))
        .stderr(Stdio::from(
            fs::File::create(profile.path().join("watch.stderr")).unwrap(),
        ));
    for name in ["PATH", "SystemRoot"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    let mut child = command.spawn().unwrap();
    let catalog = project.path().join("locales/en.po");
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut wait_for = |message: &str| {
        while !fs::read_to_string(&catalog).is_ok_and(|text| text.contains(message))
            || !fs::read_to_string(profile.path().join("watch.stdout"))
                .is_ok_and(|text| text.contains("Watching for changes..."))
        {
            if Instant::now() >= deadline || child.try_wait().unwrap().is_some() {
                let _ = child.kill();
                let _ = child.wait();
                panic!(
                    "watch did not extract {message}: stdout={}; stderr={}",
                    fs::read_to_string(profile.path().join("watch.stdout")).unwrap(),
                    fs::read_to_string(profile.path().join("watch.stderr")).unwrap()
                );
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    };
    wait_for("First");
    let before = status(profile.path(), project.path())["unsent_invocations"].clone();
    fs::write(
        &source,
        "import {t} from '@palamedes/core/macro'; export function title() { return t`Second`; }\n",
    )
    .unwrap();
    wait_for("Second");
    #[cfg(unix)]
    {
        assert!(
            Command::new("kill")
                .args(["-INT", &child.id().to_string()])
                .status()
                .unwrap()
                .success()
        );
    }
    #[cfg(not(unix))]
    child.kill().unwrap();
    child.wait().unwrap();
    assert_eq!(before, 1, "a live watch invocation must already be durable");
    assert_eq!(
        status(profile.path(), project.path())["unsent_invocations"],
        1
    );
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

fn unified_status(profile: &Path, project: &Path) -> Value {
    let output = run(profile, project, &["telemetry", "usage", "status"], &[]);
    assert!(output.status.success(), "{output:?}");
    serde_json::from_slice(&output.stdout).unwrap()
}
fn unified_enable(profile: &Path, project: &Path) {
    let output = run(
        profile,
        project,
        &[
            "telemetry",
            "usage",
            "enable",
            "--accept",
            "palamedes-events-v1",
        ],
        &[],
    );
    assert!(output.status.success(), "{output:?}");
}
#[test]
fn additional_notices_do_not_create_state_or_import_a_legacy_grant() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    for scope in ["usage", "history", "profile"] {
        let output = run(
            profile.path(),
            project.path(),
            &["telemetry", scope, "enable"],
            &[],
        );
        assert!(output.status.success(), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stdout).contains("Sebastian Software GmbH"));
        assert_eq!(fs::read_dir(profile.path()).unwrap().count(), 0);
    }
    enable(profile.path(), project.path());
    let before = unified_status(profile.path(), project.path());
    assert_eq!(before["usage"]["decision"], "undecided");
    let rejected = run(
        profile.path(),
        project.path(),
        &[
            "telemetry",
            "history",
            "enable",
            "--accept",
            "monthly-history-v1",
        ],
        &[],
    );
    assert!(!rejected.status.success());
    assert_eq!(
        unified_status(profile.path(), project.path())["history"]["decision"],
        "undecided"
    );
}
#[test]
fn unified_cutover_counts_once_and_never_grants_additional_permissions() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    enable(profile.path(), project.path());
    run(profile.path(), project.path(), &["report"], &[]);
    unified_enable(profile.path(), project.path());
    run(profile.path(), project.path(), &["report"], &[]);
    assert_eq!(
        status(profile.path(), project.path())["unsent_invocations"],
        0
    );
    let state = unified_status(profile.path(), project.path());
    assert_eq!(state["usage"]["decision"], "granted");
    assert_eq!(state["history"]["decision"], "undecided");
    assert_eq!(state["profile"]["decision"], "undecided");
    let preview = run(
        profile.path(),
        project.path(),
        &["telemetry", "usage", "preview"],
        &[],
    );
    let preview: Value = serde_json::from_slice(&preview.stdout).unwrap();
    assert_eq!(preview["open"].as_array().unwrap().len(), 1);
    assert_eq!(preview["open"][0]["count"], 1);
    assert!(!preview.to_string().contains("token"));
    assert!(
        !preview
            .to_string()
            .contains(project.path().to_str().unwrap())
    );
}
#[test]
fn additional_choices_are_independent_and_offline_withdrawal_remains_pending() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    unified_enable(profile.path(), project.path());
    for (scope, revision) in [
        ("history", "monthly-history-v1"),
        ("profile", "profile-linking-v1"),
    ] {
        let result = run(
            profile.path(),
            project.path(),
            &["telemetry", scope, "enable", "--accept", revision],
            &[],
        );
        assert!(result.status.success(), "{result:?}");
    }
    let granted = unified_status(profile.path(), project.path());
    assert_eq!(granted["history"]["decision"], "granted");
    assert_eq!(granted["history"]["pending"], true);
    assert_eq!(granted["profile"]["decision"], "granted");
    run(
        profile.path(),
        project.path(),
        &["telemetry", "history", "disable"],
        &[],
    );
    let declined = unified_status(profile.path(), project.path());
    assert_eq!(declined["history"]["decision"], "declined");
    assert_eq!(declined["history"]["pending"], true);
    assert_eq!(declined["profile"]["decision"], "granted");
    assert_eq!(declined["usage"]["collect_opt_in"], true);
    let reset = run(
        profile.path(),
        project.path(),
        &["telemetry", "profile", "reset", "--all-tools"],
        &[],
    );
    assert!(reset.status.success(), "{reset:?}");
    assert_eq!(
        unified_status(profile.path(), project.path())["profile_reset_pending"],
        true
    );
    run(
        profile.path(),
        project.path(),
        &["telemetry", "disable"],
        &[],
    );
    let stopped = unified_status(profile.path(), project.path());
    assert_eq!(stopped["usage"]["collect_opt_in"], false);
    assert_eq!(stopped["profile"]["decision"], "declined");
    assert_eq!(stopped["profile"]["pending"], true);
}
#[test]
fn legacy_environment_consent_never_enables_expanded_fields_or_profile_linking() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    run(
        profile.path(),
        project.path(),
        &["report"],
        &[("APP_TRACKING_CONSENT", "telemetry-v1")],
    );
    assert_eq!(
        unified_status(profile.path(), project.path())["usage"]["decision"],
        "undecided"
    );
    unified_enable(profile.path(), project.path());
    let denied = run(
        profile.path(),
        project.path(),
        &[
            "telemetry",
            "profile",
            "enable",
            "--accept",
            "profile-linking-v1",
        ],
        &[("CI", "1"), ("APP_TRACKING_CI", "telemetry-v1")],
    );
    assert!(!denied.status.success());
    assert_eq!(
        unified_status(profile.path(), project.path())["profile"]["decision"],
        "undecided"
    );
    run(
        profile.path(),
        project.path(),
        &["report"],
        &[("DO_NOT_TRACK", "1")],
    );
    assert_eq!(
        unified_status(profile.path(), project.path())["usage"]["open_dimensions"],
        0
    );
}

#[test]
fn publication_needs_a_third_choice_and_withdrawal_preserves_private_history() {
    let profile = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let notice = run(
        profile.path(),
        project.path(),
        &["telemetry", "publication", "enable"],
        &[],
    );
    assert!(notice.status.success());
    assert!(String::from_utf8_lossy(&notice.stdout).contains("cannot recall copies"));
    assert_eq!(fs::read_dir(profile.path()).unwrap().count(), 0);
    unified_enable(profile.path(), project.path());
    let rejected = run(
        profile.path(),
        project.path(),
        &[
            "telemetry",
            "publication",
            "enable",
            "--accept",
            "public-usage-v1",
        ],
        &[],
    );
    assert!(!rejected.status.success());
    run(
        profile.path(),
        project.path(),
        &[
            "telemetry",
            "history",
            "enable",
            "--accept",
            "monthly-history-v1",
        ],
        &[],
    );
    assert_eq!(
        unified_status(profile.path(), project.path())["publication"]["decision"],
        "undecided"
    );
    let granted = run(
        profile.path(),
        project.path(),
        &[
            "telemetry",
            "publication",
            "enable",
            "--accept",
            "public-usage-v1",
        ],
        &[],
    );
    assert!(granted.status.success(), "{granted:?}");
    let state = unified_status(profile.path(), project.path());
    assert_eq!(state["publication"]["decision"], "granted");
    assert_eq!(state["publication"]["pending"], true);
    run(
        profile.path(),
        project.path(),
        &["telemetry", "publication", "disable"],
        &[],
    );
    let state = unified_status(profile.path(), project.path());
    assert_eq!(state["publication"]["decision"], "declined");
    assert_eq!(state["publication"]["pending"], true);
    assert_eq!(state["history"]["decision"], "granted");
    assert_eq!(state["usage"]["collect_opt_in"], true);
}
