//! Shared helpers for integration tests that need their own copy of `pmds`.

use std::fs;
use std::path::Path;

/// Copies the built `pmds` binary to `destination` so it can be executed from there.
///
/// Tests run in parallel and spawn child processes. A plain `fs::copy` onto the
/// final path keeps a write descriptor open on a file that is about to be
/// executed, and a child forked by another test in that window inherits the
/// descriptor. `exec` then fails with `ETXTBSY` ("Text file busy"). The copy
/// therefore goes to a temporary sibling, is closed and synced, gets its
/// permissions, and only then is renamed into place, so the executable path never
/// has an open writer.
pub fn install_pmds_copy(destination: &Path) {
    let source = env!("CARGO_BIN_EXE_pmds");
    let directory = destination.parent().expect("destination has a parent");
    let staging = directory.join(format!(".pmds-install-{}.tmp", std::process::id()));
    {
        let mut reader = fs::File::open(source).unwrap();
        let mut writer = fs::File::create(&staging).unwrap();
        std::io::copy(&mut reader, &mut writer).unwrap();
        writer.sync_all().unwrap();
    }
    fs::set_permissions(&staging, fs::metadata(source).unwrap().permissions()).unwrap();
    fs::rename(&staging, destination).unwrap();
}
