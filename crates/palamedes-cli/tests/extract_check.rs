use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

#[test]
fn reports_po_and_fcl_drift_without_mutating_catalogs() {
    let fixture = fixture_dir("po-fcl-drift");
    write_project(
        &fixture,
        r#"locales: [de]
source-locale: de
extract-cache: true
catalogs:
  - path: locales/{locale}/messages
    format: po
    include: [src]
  - path: catalogs/{locale}/messages
    format: fcl
    include: [src]
"#,
        &["Alpha", "Removed"],
    );
    let initial = pmds(&fixture, &["extract", "--no-cache"]);
    assert!(initial.status.success(), "{initial:?}");

    let po = fixture.join("locales/de/messages.po");
    let fcl = fixture.join("catalogs/de/messages.fcl");
    let fixed_mtime = UNIX_EPOCH + Duration::from_secs(1_000_000);
    for path in [&po, &fcl] {
        fs::File::options()
            .write(true)
            .open(path)
            .expect("open catalog")
            .set_modified(fixed_mtime)
            .expect("set catalog mtime");
    }
    let po_before = fs::read(&po).expect("read PO before check");
    let fcl_before = fs::read(&fcl).expect("read FCL before check");

    write_source(&fixture, &["Alpha changed", "Added"]);
    let cold = pmds(&fixture, &["extract", "--check", "--json", "--no-cache"]);
    assert_eq!(cold.status.code(), Some(3), "{cold:?}");
    let expected = json!({
        "status": "drift",
        "catalogs": [
            { "path": "catalogs/de/messages.fcl", "change": "modified" },
            { "path": "locales/de/messages.po", "change": "modified" }
        ]
    });
    assert_eq!(json_stdout(&cold), expected);
    assert!(
        String::from_utf8_lossy(&cold.stderr)
            .contains("Catalog extraction check found drift in 2 catalog file(s)"),
        "{cold:?}"
    );
    assert_catalog_unchanged(&po, &po_before, fixed_mtime);
    assert_catalog_unchanged(&fcl, &fcl_before, fixed_mtime);

    age_file(&fixture.join("src/messages.ts"));
    let cached = pmds(&fixture, &["extract", "--check", "--json"]);
    let warm = pmds(&fixture, &["extract", "--check", "--json"]);
    assert_eq!(cached.status.code(), Some(3), "{cached:?}");
    assert_eq!(warm.status.code(), Some(3), "{warm:?}");
    assert_eq!(cold.stdout, cached.stdout);
    assert_eq!(cached.stdout, warm.stdout);
    assert!(fixture.join(".palamedes/extract-cache.json").exists());
    assert_catalog_unchanged(&po, &po_before, fixed_mtime);
    assert_catalog_unchanged(&fcl, &fcl_before, fixed_mtime);

    let update = pmds(&fixture, &["extract", "--no-cache"]);
    assert!(update.status.success(), "{update:?}");
    let clean_mtime = UNIX_EPOCH + Duration::from_secs(2_000_000);
    let po_clean = fs::read(&po).expect("read clean PO");
    let fcl_clean = fs::read(&fcl).expect("read clean FCL");
    for path in [&po, &fcl] {
        fs::File::options()
            .write(true)
            .open(path)
            .expect("open clean catalog")
            .set_modified(clean_mtime)
            .expect("set clean catalog mtime");
    }
    let clean = pmds(&fixture, &["extract", "--check", "--json", "--no-cache"]);
    assert!(clean.status.success(), "{clean:?}");
    assert_eq!(
        json_stdout(&clean),
        json!({ "status": "clean", "catalogs": [] })
    );
    assert_catalog_unchanged(&po, &po_clean, clean_mtime);
    assert_catalog_unchanged(&fcl, &fcl_clean, clean_mtime);

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn reports_missing_catalog_as_created_without_creating_parent_directories() {
    let fixture = fixture_dir("created");
    write_project(
        &fixture,
        r#"locales: [de]
source-locale: de
extract-cache: false
catalogs:
  - path: generated/deep/{locale}/messages
    format: po
    include: [src]
"#,
        &["Hello"],
    );

    let output = pmds(&fixture, &["extract", "--check", "--json"]);

    assert_eq!(output.status.code(), Some(3), "{output:?}");
    assert_eq!(
        json_stdout(&output),
        json!({
            "status": "drift",
            "catalogs": [
                { "path": "generated/deep/de/messages.po", "change": "created" }
            ]
        })
    );
    let human = pmds(&fixture, &["extract", "--check"]);
    assert_eq!(human.status.code(), Some(3), "{human:?}");
    assert_eq!(
        String::from_utf8_lossy(&human.stdout),
        "Catalog drift detected:\n  create generated/deep/de/messages.po\n"
    );
    assert!(!fixture.join("generated").exists());
    assert!(
        !fixture.join(".git").exists(),
        "fixture intentionally runs outside Git"
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn detects_formatting_only_drift_without_rewriting_the_catalog() {
    let fixture = fixture_dir("formatting");
    write_project(
        &fixture,
        r#"locales: [de]
source-locale: de
extract-cache: false
catalogs:
  - path: locales/{locale}/messages
    format: po
    include: [src]
"#,
        &["Hello"],
    );
    assert!(pmds(&fixture, &["extract"]).status.success());
    let catalog = fixture.join("locales/de/messages.po");
    let mut noncanonical = fs::read_to_string(&catalog).expect("read catalog");
    noncanonical.push('\n');
    fs::write(&catalog, &noncanonical).expect("write formatting drift");

    let output = pmds(&fixture, &["extract", "--check", "--json"]);

    assert_eq!(output.status.code(), Some(3), "{output:?}");
    assert_eq!(
        json_stdout(&output)["catalogs"],
        json!([{ "path": "locales/de/messages.po", "change": "modified" }])
    );
    assert_eq!(
        fs::read_to_string(&catalog).expect("read after check"),
        noncanonical
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn force_clean_check_previews_obsolete_removal_without_applying_it() {
    let fixture = fixture_dir("force-clean");
    write_project(
        &fixture,
        r#"locales: [de]
source-locale: de
extract-cache: false
catalogs:
  - path: locales/{locale}/messages
    format: po
    include: [src]
"#,
        &["Removed"],
    );
    assert!(pmds(&fixture, &["extract"]).status.success());
    let catalog = fixture.join("locales/de/messages.po");
    let before = fs::read_to_string(&catalog).expect("read catalog");
    write_source(&fixture, &[]);

    let check = pmds(&fixture, &["extract", "--check", "--json", "--force-clean"]);

    assert_eq!(check.status.code(), Some(3), "{check:?}");
    assert_eq!(
        fs::read_to_string(&catalog).expect("read after check"),
        before
    );
    let apply = pmds(&fixture, &["extract", "--force-clean"]);
    assert!(apply.status.success(), "{apply:?}");
    assert!(!fs::read_to_string(&catalog)
        .expect("read after cleanup")
        .contains("Removed"));

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn json_distinguishes_execution_errors_and_clap_rejects_invalid_combinations() {
    let fixture = fixture_dir("errors");
    fs::create_dir_all(&fixture).expect("create fixture");

    let failure = pmds(&fixture, &["extract", "--check", "--json"]);
    assert_eq!(failure.status.code(), Some(1), "{failure:?}");
    let report = json_stdout(&failure);
    assert_eq!(report["status"], "error");
    assert_eq!(report["catalogs"], json!([]));
    assert!(
        report["error"]["message"]
            .as_str()
            .is_some_and(|message| message.contains("Could not find a Palamedes config")),
        "{report}"
    );

    let watch = pmds(&fixture, &["extract", "--check", "--watch"]);
    assert_eq!(watch.status.code(), Some(2), "{watch:?}");
    assert!(
        String::from_utf8_lossy(&watch.stderr).contains("cannot be used with '--watch'"),
        "{watch:?}"
    );
    let json_without_check = pmds(&fixture, &["extract", "--json"]);
    assert_eq!(
        json_without_check.status.code(),
        Some(2),
        "{json_without_check:?}"
    );
    assert!(
        String::from_utf8_lossy(&json_without_check.stderr)
            .contains("the following required arguments were not provided"),
        "{json_without_check:?}"
    );

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn extracts_sources_from_a_parent_sibling_directory() {
    let workspace = fixture_dir("parent-sibling");
    let web = workspace.join("web");
    let api = workspace.join("api");
    fs::create_dir_all(api.join("src")).expect("create sibling source directory");
    fs::create_dir_all(&web).expect("create configured project");
    fs::write(
        web.join("palamedes.yaml"),
        r#"locales: [de]
source-locale: de
extract-cache: false
catalogs:
  - path: locales/{locale}/messages
    format: po
    include: [../api/src]
"#,
    )
    .expect("write config");
    fs::write(
        api.join("src/messages.ts"),
        "import { t } from \"@palamedes/core/macro\";\nexport function message() { return t`Sibling API`; }\n",
    )
    .expect("write sibling source");

    let output = pmds(&web, &["extract", "--no-cache"]);

    assert!(output.status.success(), "{output:?}");
    let catalog =
        fs::read_to_string(web.join("locales/de/messages.po")).expect("read generated catalog");
    assert!(catalog.contains("msgid \"Sibling API\""), "{catalog}");

    fs::remove_dir_all(workspace).expect("cleanup fixture");
}

fn write_project(root: &Path, config: &str, messages: &[&str]) {
    fs::create_dir_all(root.join("src")).expect("create source directory");
    fs::write(root.join("palamedes.yaml"), config).expect("write config");
    write_source(root, messages);
}

fn write_source(root: &Path, messages: &[&str]) {
    let calls = messages
        .iter()
        .map(|message| format!("t`{message}`"))
        .collect::<Vec<_>>()
        .join(", ");
    fs::write(
        root.join("src/messages.ts"),
        format!(
            "import {{ t }} from \"@palamedes/core/macro\";\nexport function messages() {{ return [{calls}]; }}\n"
        ),
    )
    .expect("write source");
}

fn pmds(root: &Path, arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args(arguments)
        .current_dir(root)
        .output()
        .expect("run pmds")
}

fn json_stdout(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "parse JSON stdout: {error}\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn assert_catalog_unchanged(path: &Path, expected: &[u8], modified: SystemTime) {
    assert_eq!(fs::read(path).expect("read catalog after check"), expected);
    assert_eq!(
        fs::metadata(path)
            .expect("catalog metadata")
            .modified()
            .expect("catalog mtime"),
        modified
    );
}

fn age_file(path: &Path) {
    fs::File::options()
        .write(true)
        .open(path)
        .expect("open source")
        .set_modified(SystemTime::now() - Duration::from_secs(10))
        .expect("age source");
}

fn fixture_dir(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "palamedes-cli-extract-check-{name}-{}-{stamp}",
        std::process::id()
    ))
}
