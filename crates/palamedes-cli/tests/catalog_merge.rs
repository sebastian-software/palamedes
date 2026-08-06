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
            "--format",
            "po",
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

fn initialize_git_fixture(fixture: &std::path::Path) {
    fs::create_dir_all(fixture).expect("create git fixture");
    git(fixture, &["init", "-b", "main"]);
    git(fixture, &["config", "user.name", "Palamedes Test"]);
    git(
        fixture,
        &["config", "user.email", "palamedes@example.invalid"],
    );
    git(fixture, &["config", "commit.gpgsign", "false"]);
    let driver = format!(
        "'{}' catalog merge-driver %O %A %B %A --path %P --format po --source-locale en --locale de --conflict-strategy use-first",
        env!("CARGO_BIN_EXE_pmds").replace('\'', "'\\''")
    );
    git(
        fixture,
        &["config", "merge.palamedes-catalog.driver", &driver],
    );
    fs::write(
        fixture.join(".gitattributes"),
        "messages.po merge=palamedes-catalog\n",
    )
    .expect("write attributes");
    write_translation(fixture, "Base");
    commit_all(fixture, "base catalog");
}

fn write_translation(fixture: &std::path::Path, translation: &str) {
    fs::write(
        fixture.join("messages.po"),
        format!(
            "msgid \"\"\nmsgstr \"\"\n\"Language: de\\n\"\n\nmsgid \"Hello\"\nmsgstr \"{translation}\"\n"
        ),
    )
    .expect("write catalog");
}

fn assert_translation(fixture: &std::path::Path, translation: &str) {
    let content = fs::read_to_string(fixture.join("messages.po")).expect("read catalog");
    assert!(
        content.contains(&format!("msgstr \"{translation}\"")),
        "{content}"
    );
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
