use std::process::Command;

#[test]
fn help_is_owned_by_clap_before_plugin_dispatch() {
    let output = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .arg("help")
        .output()
        .expect("run pmds help");

    assert!(output.status.success(), "{output:?}");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("Usage: pmds"),
        "{output:?}"
    );
    assert!(
        !String::from_utf8_lossy(&output.stdout).contains("PLUGIN_"),
        "{output:?}"
    );
}
