use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn base_only_entry_deleted_from_both_sides_stays_deleted() {
    let fixture = fixture_dir("catalog-three-way-delete");
    fs::create_dir_all(&fixture).expect("create fixture");
    let base = fixture.join("base.po");
    let ours = fixture.join("ours.po");
    let theirs = fixture.join("theirs.po");
    let output = fixture.join("merged.po");
    fs::write(&base, "msgid \"Removed on both sides\"\nmsgstr \"Alt\"\n").expect("write base");
    fs::write(&ours, "").expect("write ours");
    fs::write(&theirs, "").expect("write theirs");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args([
            "catalog",
            "merge",
            ours.to_str().expect("ours path"),
            theirs.to_str().expect("theirs path"),
            "--base",
            base.to_str().expect("base path"),
            "--output",
            output.to_str().expect("output path"),
            "--source-locale",
            "en",
            "--locale",
            "de",
        ])
        .output()
        .expect("run catalog merge");

    assert!(result.status.success(), "{result:?}");
    let merged = fs::read_to_string(&output).expect("read merged catalog");
    assert!(!merged.contains("Removed on both sides"), "{merged}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn merge_driver_use_first_keeps_the_current_branch_during_merge() {
    let fixture = fixture_dir("catalog-driver-merge");
    initialize_git_fixture(&fixture);

    git(&fixture, &["checkout", "-b", "feature"]);
    write_translation(&fixture, "Feature");
    commit_all(&fixture, "feature translation");
    git(&fixture, &["checkout", "main"]);
    write_translation(&fixture, "Main");
    commit_all(&fixture, "main translation");

    git(&fixture, &["merge", "feature"]);
    assert_translation(&fixture, "Main");
    assert_unwrapped_catalog_message(&fixture);

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn merge_driver_use_first_keeps_the_rebased_branch_during_rebase() {
    let fixture = fixture_dir("catalog-driver-rebase");
    initialize_git_fixture(&fixture);

    git(&fixture, &["checkout", "-b", "feature"]);
    write_translation(&fixture, "Feature");
    commit_all(&fixture, "feature translation");
    git(&fixture, &["checkout", "main"]);
    write_translation(&fixture, "Upstream");
    commit_all(&fixture, "upstream translation");
    git(&fixture, &["checkout", "feature"]);

    git(&fixture, &["rebase", "main"]);
    assert_translation(&fixture, "Feature");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn merge_driver_infers_fcl_from_the_logical_git_path() {
    let fixture = fixture_dir("catalog-driver-fcl");
    initialize_fcl_git_fixture(&fixture);

    git(&fixture, &["checkout", "-b", "feature"]);
    write_fcl_translation(&fixture, "Feature");
    commit_all(&fixture, "feature translation");
    git(&fixture, &["checkout", "main"]);
    write_fcl_translation(&fixture, "Main");
    commit_all(&fixture, "main translation");

    git(&fixture, &["merge", "feature"]);
    let content = fs::read_to_string(fixture.join(FCL_CATALOG)).expect("read FCL catalog");
    assert!(content.starts_with("%FCL1"), "{content}");
    assert!(content.contains("Hello\t\tMain"), "{content}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn explicit_format_overrides_the_logical_path() {
    let fixture = fixture_dir("catalog-merge-explicit-format");
    fs::create_dir_all(&fixture).expect("create fixture");
    let base = fixture.join("base");
    let ours = fixture.join("ours");
    let theirs = fixture.join("theirs");
    let output = fixture.join("output");
    fs::write(&base, "msgid \"Hello\"\nmsgstr \"Alt\"\n").expect("write base");
    fs::write(&ours, "msgid \"Hello\"\nmsgstr \"Unser\"\n").expect("write ours");
    fs::write(&theirs, "msgid \"Hello\"\nmsgstr \"Ihr\"\n").expect("write theirs");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args([
            "catalog",
            "merge-driver",
            base.to_str().expect("base path"),
            ours.to_str().expect("ours path"),
            theirs.to_str().expect("theirs path"),
            output.to_str().expect("output path"),
            "--path",
            "catalog.fcl",
            "--format",
            "po",
            "--source-locale",
            "en",
            "--locale",
            "de",
        ])
        .output()
        .expect("run catalog merge driver");

    assert!(result.status.success(), "{result:?}");
    assert!(fs::read_to_string(&output)
        .expect("read output")
        .contains("msgstr \"Unser\""));
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn merge_uses_the_logical_path_without_a_three_way_base() {
    let fixture = fixture_dir("catalog-merge-logical-format-hint");
    fs::create_dir_all(&fixture).expect("create fixture");
    let ours = fixture.join("ours");
    let theirs = fixture.join("theirs");
    let output = fixture.join("output");
    fs::write(&ours, "msgid \"Hello\"\nmsgstr \"Unser\"\n").expect("write ours");
    fs::write(&theirs, "msgid \"New\"\nmsgstr \"Neu\"\n").expect("write theirs");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args([
            "catalog",
            "merge",
            ours.to_str().expect("ours path"),
            theirs.to_str().expect("theirs path"),
            "--output",
            output.to_str().expect("output path"),
            "--path",
            "apps/web/locales/de.po",
            "--source-locale",
            "en",
            "--locale",
            "de",
        ])
        .output()
        .expect("run catalog merge");

    assert!(result.status.success(), "{result:?}");
    let merged = fs::read_to_string(&output).expect("read output");
    assert!(merged.contains("msgstr \"Unser\""), "{merged}");
    assert!(merged.contains("msgid \"New\""), "{merged}");
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

#[test]
fn extensionless_driver_files_report_the_logical_path_when_format_is_unknown() {
    let fixture = fixture_dir("catalog-merge-unknown-logical-format");
    fs::create_dir_all(&fixture).expect("create fixture");
    let base = fixture.join("base");
    let ours = fixture.join("ours");
    let theirs = fixture.join("theirs");
    let output = fixture.join("output");
    for path in [&base, &ours, &theirs] {
        fs::write(path, "msgid \"Hello\"\nmsgstr \"Hallo\"\n").expect("write catalog");
    }

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args([
            "catalog",
            "merge-driver",
            base.to_str().expect("base path"),
            ours.to_str().expect("ours path"),
            theirs.to_str().expect("theirs path"),
            output.to_str().expect("output path"),
            "--path",
            "catalog.unknown",
            "--source-locale",
            "en",
            "--locale",
            "de",
        ])
        .output()
        .expect("run catalog merge driver");

    assert!(!result.status.success());
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("catalog.unknown"), "{stderr}");
    assert!(stderr.contains("merge paths"), "{stderr}");
    assert!(stderr.contains("--format po or --format fcl"), "{stderr}");
    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

/// A JS/TS config is a supported project setup the native CLI cannot read.
/// The merge driver has to merge anyway, or Git leaves every catalog conflicted
/// in those projects.
#[test]
fn merges_in_a_project_configured_in_typescript() {
    let fixture = fixture_dir("catalog-merge-js-config");
    fs::create_dir_all(&fixture).expect("create fixture");
    fs::write(
        fixture.join("palamedes.config.ts"),
        "export default { locales: [\"en\", \"de\"], sourceLocale: \"en\" }\n",
    )
    .expect("write TypeScript config");
    let base = fixture.join("base.po");
    let ours = fixture.join("ours.po");
    let theirs = fixture.join("theirs.po");
    let output = fixture.join("merged.po");
    fs::write(&base, "msgid \"Hello\"\nmsgstr \"Alt\"\n").expect("write base");
    fs::write(&ours, "msgid \"Hello\"\nmsgstr \"Unser\"\n").expect("write ours");
    fs::write(&theirs, "msgid \"Hello\"\nmsgstr \"Ihr\"\n").expect("write theirs");

    let result = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .args([
            "catalog",
            "merge",
            ours.to_str().expect("ours path"),
            theirs.to_str().expect("theirs path"),
            "--base",
            base.to_str().expect("base path"),
            "--output",
            output.to_str().expect("output path"),
            "--locale",
            "de",
        ])
        .current_dir(&fixture)
        .output()
        .expect("run catalog merge");

    assert!(result.status.success(), "{result:?}");
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert!(stderr.contains("palamedes.config.ts"), "{stderr}");
    let merged = fs::read_to_string(&output).expect("read merged catalog");
    assert!(merged.contains("msgstr \"Unser\""), "{merged}");

    fs::remove_dir_all(fixture).expect("cleanup fixture");
}

const PO_CATALOG: &str = "apps/web/locales/de.po";
const FCL_CATALOG: &str = "apps/web/fcl/de.fcl";

fn initialize_git_fixture(fixture: &std::path::Path) {
    initialize_git(fixture);
    write_translation(fixture, "Base");
    commit_all(fixture, "base catalog");
}

fn initialize_fcl_git_fixture(fixture: &std::path::Path) {
    initialize_git(fixture);
    write_fcl_translation(fixture, "Base");
    commit_all(fixture, "base catalog");
}

fn initialize_git(fixture: &std::path::Path) {
    fs::create_dir_all(fixture.join("apps/web/locales")).expect("create git fixture");
    fs::create_dir_all(fixture.join("apps/web/fcl")).expect("create FCL directory");
    git(fixture, &["init", "-b", "main"]);
    git(fixture, &["config", "user.name", "Palamedes Test"]);
    git(
        fixture,
        &["config", "user.email", "palamedes@example.invalid"],
    );
    git(fixture, &["config", "commit.gpgsign", "false"]);
    let driver = format!(
        "'{}' catalog merge-driver %O %A %B %A --path %P --config apps/web/palamedes.yaml --source-locale en --locale de --conflict-strategy use-first",
        env!("CARGO_BIN_EXE_pmds").replace('\'', "'\\''")
    );
    git(
        fixture,
        &["config", "merge.palamedes-catalog.driver", &driver],
    );
    fs::write(
        fixture.join(".gitattributes"),
        "*.po merge=palamedes-catalog\n*.fcl merge=palamedes-catalog\n",
    )
    .expect("write attributes");
    fs::write(
        fixture.join("apps/web/palamedes.yaml"),
        r#"
locales: [en, de]
source-locale: en
catalogs:
  - path: locales/{locale}
    include: [src]
    po:
      line-breaks: "off"
  - path: fcl/{locale}
    format: fcl
    include: [src]
"#,
    )
    .expect("write nested config");
}

fn write_translation(fixture: &std::path::Path, translation: &str) {
    let long = long_message();
    fs::write(
        fixture.join(PO_CATALOG),
        format!(
            "msgid \"\"\nmsgstr \"\"\n\"Language: de\\n\"\n\nmsgid \"{long}\"\nmsgstr \"{long}\"\n\nmsgid \"Hello\"\nmsgstr \"{translation}\"\n"
        ),
    )
    .expect("write catalog");
}

fn assert_unwrapped_catalog_message(fixture: &std::path::Path) {
    let content = fs::read_to_string(fixture.join(PO_CATALOG)).expect("read catalog");
    assert!(
        content.contains(&format!("msgid \"{}\"", long_message())),
        "configured line-breaks: off must survive the merge: {content}"
    );
}

fn long_message() -> &'static str {
    "A deliberately long catalog message that must stay on one line after a merge driver writes it."
}

fn assert_translation(fixture: &std::path::Path, translation: &str) {
    let content = fs::read_to_string(fixture.join(PO_CATALOG)).expect("read catalog");
    assert!(
        content.contains(&format!("msgstr \"{translation}\"")),
        "{content}"
    );
}

fn write_fcl_translation(fixture: &std::path::Path, translation: &str) {
    fs::write(
        fixture.join(FCL_CATALOG),
        format!("%FCL1\tsource=en\tlocale=de\nHello\t\t{translation}\n"),
    )
    .expect("write FCL catalog");
}

fn commit_all(fixture: &std::path::Path, message: &str) {
    git(fixture, &["add", "."]);
    git(fixture, &["commit", "-m", message]);
}

fn git(fixture: &std::path::Path, arguments: &[&str]) -> std::process::Output {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(fixture)
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
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
