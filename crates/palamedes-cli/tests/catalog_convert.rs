use std::fs;
use std::path::Path;
use std::process::{Command, Output};

const PO: &str =
    "msgid \"\"\nmsgstr \"\"\n\"Language: en\\n\"\n\nmsgid \"Hello\"\nmsgstr \"Hello\"\n";

fn convert(directory: &Path, input: &str, output: &str) -> Output {
    Command::new(env!("CARGO_BIN_EXE_pmds"))
        .current_dir(directory)
        .env(
            "PALAMEDES_UI_CATALOG_DIR",
            concat!(env!("OUT_DIR"), "/catalogs"),
        )
        .env("PALAMEDES_UI_LOCALE", "en")
        .env("PALAMEDES_UPDATE_CHECK", "0")
        .args([
            "catalog", "convert", input, "--to", "fcl", "--output", output,
        ])
        .output()
        .unwrap()
}

#[test]
fn rejects_input_aliases_without_changing_the_catalog() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("messages.po"), PO).unwrap();
    fs::create_dir(root.join("sub")).unwrap();
    fs::hard_link(root.join("messages.po"), root.join("hardlink.fcl")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("messages.po", root.join("symlink.fcl")).unwrap();

    let mut aliases = vec!["messages.po", "sub/../messages.po"];
    aliases.push("hardlink.fcl");
    #[cfg(unix)]
    aliases.push("symlink.fcl");
    for alias in aliases {
        let result = convert(root, "messages.po", alias);
        assert!(!result.status.success(), "{alias}: {result:?}");
        assert!(
            String::from_utf8_lossy(&result.stderr)
                .contains("output must not refer to the input catalog")
        );
        assert_eq!(fs::read(root.join("messages.po")).unwrap(), PO.as_bytes());
    }
}

#[test]
fn replaces_a_separate_existing_output() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("messages.po"), PO).unwrap();
    fs::write(root.join("messages.fcl"), "old output").unwrap();
    fs::create_dir(root.join("sub")).unwrap();
    let result = convert(root, "messages.po", "sub/../messages.fcl");
    assert!(result.status.success(), "{result:?}");
    assert_eq!(fs::read(root.join("messages.po")).unwrap(), PO.as_bytes());
    assert!(
        fs::read_to_string(root.join("messages.fcl"))
            .unwrap()
            .starts_with("%FCL1")
    );
}

#[cfg(unix)]
#[test]
fn replaces_a_write_only_destination() {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::write(root.join("messages.po"), PO).unwrap();
    let destination = root.join("messages.fcl");
    fs::write(&destination, "old output ".repeat(1000)).unwrap();
    fs::set_permissions(&destination, fs::Permissions::from_mode(0o200)).unwrap();
    let result = convert(root, "messages.po", "messages.fcl");
    assert!(result.status.success(), "{result:?}");
    assert_eq!(fs::read(root.join("messages.po")).unwrap(), PO.as_bytes());
    let output = fs::read_to_string(destination).unwrap();
    assert!(output.starts_with("%FCL1"));
    assert!(!output.contains("old output"));
}
