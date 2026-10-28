//! Shared helpers for integration tests that need their own copy of `pmds`.

use std::fs;
use std::io;
use std::path::Path;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

static STAGING_COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Makes `destination` an executable `pmds` that tests can run.
///
/// `ETXTBSY` ("Text file busy") is a per-inode condition: `exec` fails while any
/// process holds a write descriptor on the file. Tests run in parallel and
/// fork children, and a child forked while another test still has a freshly
/// copied binary open for writing inherits that descriptor until its own exec.
/// Renaming such a copy keeps the inode, so it does not remove the risk.
///
/// What prevents the failure here:
/// 1. A hard link to the binary Cargo built. Cargo finished writing it before
///    any test started, so no writer descriptor exists for that inode.
/// 2. Where hard links are unavailable (another filesystem, Windows), a
///    copy that is closed and synced before being renamed into place. That
///    narrows the window but cannot close it, so callers run the result through
///    [`output`], which retries `exec` on `ETXTBSY`.
pub fn install_pmds_copy(destination: &Path) {
    let source = Path::new(env!("CARGO_BIN_EXE_pmds"));
    if fs::hard_link(source, destination).is_ok() {
        return;
    }
    let directory = destination.parent().expect("destination has a parent");
    let staging = directory.join(format!(
        ".pmds-install-{}-{}.tmp",
        std::process::id(),
        STAGING_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    {
        let mut reader = fs::File::open(source).unwrap();
        let mut writer = fs::File::create(&staging).unwrap();
        io::copy(&mut reader, &mut writer).unwrap();
        writer.sync_all().unwrap();
    }
    fs::set_permissions(&staging, fs::metadata(source).unwrap().permissions()).unwrap();
    fs::rename(&staging, destination).unwrap();
}

/// Runs `command` to completion, retrying a few times when `exec` reports
/// `ETXTBSY` because a forked child still holds a write descriptor on the
/// binary.
pub fn output(command: &mut Command) -> Output {
    const ATTEMPTS: u32 = 8;
    for attempt in 1..=ATTEMPTS {
        match command.output() {
            Err(error) if is_text_file_busy(&error) && attempt < ATTEMPTS => {
                thread::sleep(Duration::from_millis(25 * u64::from(attempt)));
            }
            result => return result.unwrap(),
        }
    }
    unreachable!("the last attempt always returns")
}

fn is_text_file_busy(error: &io::Error) -> bool {
    // ETXTBSY is 26 on Linux and macOS.
    cfg!(unix) && error.raw_os_error() == Some(26)
}
