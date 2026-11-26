//! Directory-handle-pinned filesystem operations for catalog reads and writes.
//!
//! On Unix, directory traversal uses search-only handles (`O_PATH` on Linux,
//! `O_SEARCH` on BSD/macOS) with `O_NOFOLLOW`, and reads, identity checks, and
//! atomic replacements execute directly against the verified directory file
//! descriptor while preserving original ownership and permissions safely.
//!
//! On Windows, child directory traversal, directory creation, reads, identity
//! checks, temporary-file creation (with preserved DACL security descriptors),
//! and atomic renames execute handle-relatively via `NtCreateFile` and
//! `NtSetInformationFile` with `RootDirectory` and `FILE_OPEN_REPARSE_POINT`,
//! never re-resolving ancestor pathnames.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::error::{PalamedesError, PalamedesResult};

/// Failure returned by [`ContainedDir`] operations.
#[derive(Debug)]
pub enum ContainedFsError {
    /// A path escaped its root directory or encountered a symlink/reparse point.
    Containment(String),
    /// An underlying operating-system I/O error.
    Io(io::Error),
}

impl ContainedFsError {
    /// Converts this error into an [`io::Error`], mapping containment failures
    /// to [`io::ErrorKind::PermissionDenied`].
    #[must_use]
    pub fn into_io_error(self) -> io::Error {
        match self {
            Self::Containment(message) => io::Error::new(io::ErrorKind::PermissionDenied, message),
            Self::Io(error) => error,
        }
    }
}

impl fmt::Display for ContainedFsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Containment(message) => f.write_str(message),
            Self::Io(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ContainedFsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Containment(_) => None,
            Self::Io(error) => Some(error),
        }
    }
}

impl From<io::Error> for ContainedFsError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Permissions policy for newly created files written via [`ContainedDir`].
///
/// Existing files always preserve their previous access controls and are
/// populated privately before replacement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContainedNewFileMode {
    /// Create new files with private `0600` permissions on Unix (matching
    /// Ferrocat's temporary-file writer).
    Private,
    /// Create new files with `0666` masked by the process umask on Unix
    /// (matching `std::fs::write` for compiled JavaScript modules).
    RespectUmask,
}

/// Durability level for atomic replacements via [`ContainedDir`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContainedWriteDurability {
    /// Flush and atomically rename without fsync barriers.
    Rename,
    /// Sync the temporary file (after restoring metadata) before atomic
    /// rename, without syncing the containing directory. Callers that need
    /// custom directory-sync handling can invoke [`ContainedDir::sync_directory`]
    /// immediately afterward.
    FileOnly,
    /// Sync the temporary file (after restoring metadata) before atomic
    /// rename, and sync the containing directory afterward on Unix.
    Full,
}

impl ContainedWriteDurability {
    const fn syncs_file(self) -> bool {
        matches!(self, Self::FileOnly | Self::Full)
    }
}

/// Outcome of an atomic file replacement via [`ContainedDir`].
#[derive(Debug)]
pub enum ContainedWriteOutcome {
    /// The replacement committed and met the requested durability level.
    Committed,
    /// The rename committed visibly on disk, so the new contents are live,
    /// but syncing the containing directory failed.
    CommittedWithoutDirSync(io::Error),
}

/// Stable on-disk file identity used to detect hard-linked input/output aliases.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FileIdentity {
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(windows)]
    volume_serial: u32,
    #[cfg(windows)]
    file_index_high: u32,
    #[cfg(windows)]
    file_index_low: u32,
    #[cfg(not(any(unix, windows)))]
    _unsupported: (),
}

/// Splits a validated catalog path inside `root_dir` into its relative parent
/// directory and single-segment filename.
///
/// # Errors
///
/// Returns [`ContainedFsError::Containment`] when `target` is outside
/// `root_dir`, contains traversal components, or has no filename segment.
pub fn split_relative_catalog_path(
    root_dir: &Path,
    target: &Path,
) -> Result<(PathBuf, OsString), ContainedFsError> {
    let relative = target.strip_prefix(root_dir).map_err(|_| {
        ContainedFsError::Containment(format!(
            "path {} escapes root directory {}",
            target.display(),
            root_dir.display()
        ))
    })?;
    let mut segments = Vec::new();
    for component in relative.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => segments.push(part.to_os_string()),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ContainedFsError::Containment(format!(
                    "path {} escapes root directory {}",
                    target.display(),
                    root_dir.display()
                )));
            }
        }
    }
    let Some(file_name) = segments.pop() else {
        return Err(ContainedFsError::Containment(format!(
            "path {} has no filename component",
            target.display()
        )));
    };
    let mut parent = PathBuf::new();
    for segment in segments {
        parent.push(segment);
    }
    Ok((parent, file_name))
}

/// Reads an optional catalog file through a verified [`ContainedDir`] handle
/// chain anchored at `root_dir`.
///
/// Returns `Ok(None)` when either an intermediate directory or the target file
/// does not exist.
///
/// # Errors
///
/// Returns [`PalamedesError::UnsafeCatalogPath`] when the path escapes
/// `root_dir` or traverses a symlink/reparse point, or
/// [`PalamedesError::ReadFile`] on OS read errors.
pub(crate) fn read_optional_contained_catalog_file(
    root_dir: &Path,
    target: &Path,
) -> PalamedesResult<Option<String>> {
    let (relative_parent, file_name) =
        split_relative_catalog_path(root_dir, target).map_err(|error| {
            PalamedesError::UnsafeCatalogPath {
                path: target.to_string_lossy().into_owned(),
                reason: error.to_string(),
            }
        })?;
    let parent_dir = match ContainedDir::open_subpath(root_dir, &relative_parent, false) {
        Ok(Some(dir)) => dir,
        Ok(None) => return Ok(None),
        Err(ContainedFsError::Containment(reason)) => {
            return Err(PalamedesError::UnsafeCatalogPath {
                path: target.to_string_lossy().into_owned(),
                reason,
            });
        }
        Err(ContainedFsError::Io(source)) if source.kind() == io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(ContainedFsError::Io(source)) => {
            return Err(PalamedesError::ReadFile {
                path: target.to_path_buf(),
                source,
            });
        }
    };
    match parent_dir.read_optional_file(&file_name) {
        Ok(content) => Ok(content),
        Err(ContainedFsError::Containment(reason)) => Err(PalamedesError::UnsafeCatalogPath {
            path: target.to_string_lossy().into_owned(),
            reason,
        }),
        Err(ContainedFsError::Io(source)) => Err(PalamedesError::ReadFile {
            path: target.to_path_buf(),
            source,
        }),
    }
}

fn validate_single_file_name(file_name: &OsStr) -> Result<(), ContainedFsError> {
    let mut components = Path::new(file_name).components();
    if matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none() {
        Ok(())
    } else {
        Err(ContainedFsError::Containment(format!(
            "filename \"{}\" must be a single path segment",
            file_name.to_string_lossy()
        )))
    }
}

fn validate_relative_dir_segments(relative_dir: &Path) -> Result<Vec<OsString>, ContainedFsError> {
    let mut segments = Vec::new();
    for component in relative_dir.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => segments.push(part.to_os_string()),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ContainedFsError::Containment(format!(
                    "relative directory {} contains an escaping component",
                    relative_dir.display()
                )));
            }
        }
    }
    Ok(segments)
}

#[cfg(unix)]
mod platform {
    use std::ffi::{CString, OsStr, OsString};
    use std::fs::File;
    use std::io::{self, Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, ContainedWriteOutcome,
        FileIdentity, validate_relative_dir_segments, validate_single_file_name,
    };

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    #[cfg(target_os = "linux")]
    const DIR_TRAVERSAL_FLAGS: libc::c_int = libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC;
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd"
    ))]
    const DIR_TRAVERSAL_FLAGS: libc::c_int = libc::O_SEARCH | libc::O_DIRECTORY | libc::O_CLOEXEC;
    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd"
    )))]
    const DIR_TRAVERSAL_FLAGS: libc::c_int = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC;

    const USES_SEARCH_ONLY_DIR_HANDLE: bool = cfg!(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd"
    ));

    #[derive(Clone, Copy)]
    struct ExistingEntry {
        mode: libc::mode_t,
        uid: libc::uid_t,
        gid: libc::gid_t,
        identity: FileIdentity,
    }

    struct ExistingTarget {
        entry: ExistingEntry,
        acl: Option<ExistingAcl>,
    }

    #[cfg(target_os = "linux")]
    struct ExistingAcl {
        posix_access: Option<Vec<u8>>,
        nfs4: Option<Vec<u8>>,
    }

    #[cfg(target_os = "macos")]
    struct ExistingAcl(*mut libc::c_void);

    #[cfg(target_os = "macos")]
    impl Drop for ExistingAcl {
        fn drop(&mut self) {
            // SAFETY: `self.0` was returned by `acl_get_fd_np` and has not been freed.
            unsafe {
                let _ = macos_acl::acl_free(self.0);
            }
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    struct ExistingAcl;

    #[cfg(target_os = "macos")]
    mod macos_acl {
        pub(super) const ACL_TYPE_EXTENDED: libc::c_int = 0x0000_0100;
        pub(super) const ACL_FIRST_ENTRY: libc::c_int = 0;

        unsafe extern "C" {
            pub(super) fn acl_get_fd_np(fd: libc::c_int, type_: libc::c_int) -> *mut libc::c_void;
            pub(super) fn acl_set_fd_np(
                fd: libc::c_int,
                acl: *mut libc::c_void,
                type_: libc::c_int,
            ) -> libc::c_int;
            pub(super) fn acl_get_entry(
                acl: *mut libc::c_void,
                entry_id: libc::c_int,
                entry_p: *mut *mut libc::c_void,
            ) -> libc::c_int;
            pub(super) fn acl_free(obj_p: *mut libc::c_void) -> libc::c_int;
        }
    }

    /// Open handle to a verified directory used for containment-enforcing I/O.
    #[derive(Debug)]
    pub struct ContainedDir {
        fd: OwnedFd,
    }

    impl ContainedDir {
        /// Opens `root_dir` as the anchor directory for contained operations.
        ///
        /// Uses a search-only handle where supported so traversing execute-only
        /// (`0111`) directories succeeds without requiring directory-listing
        /// permissions.
        ///
        /// # Errors
        ///
        /// Returns an error when `root_dir` cannot be opened as a directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            let c_path = os_str_to_cstring(root_dir.as_os_str())?;
            // SAFETY: `c_path` is a valid NUL-terminated path string.
            let raw = unsafe { libc::open(c_path.as_ptr(), DIR_TRAVERSAL_FLAGS) };
            if raw < 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            // SAFETY: `raw` is a newly opened valid file descriptor owned by this struct.
            let fd = unsafe { OwnedFd::from_raw_fd(raw) };
            Ok(Self { fd })
        }

        /// Opens `relative_dir` under `root_dir` step by step without following
        /// symlinks, optionally creating missing intermediate directories.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] when a segment is unsafe or
        /// encounters a symlink, or [`ContainedFsError::Io`] on OS errors.
        pub fn open_subpath(
            root_dir: &Path,
            relative_dir: &Path,
            create_missing: bool,
        ) -> Result<Option<Self>, ContainedFsError> {
            let segments = validate_relative_dir_segments(relative_dir)?;
            let mut current = Self::open_root(root_dir)?;
            for segment in segments {
                let c_segment = os_str_to_cstring(&segment)?;
                if create_missing {
                    // SAFETY: `current.fd` is an open directory descriptor and `c_segment` is valid.
                    let rc =
                        unsafe { libc::mkdirat(current.fd.as_raw_fd(), c_segment.as_ptr(), 0o777) };
                    if rc != 0 {
                        let error = io::Error::last_os_error();
                        if error.raw_os_error() != Some(libc::EEXIST) {
                            return Err(ContainedFsError::Io(error));
                        }
                    }
                }
                // SAFETY: `current.fd` is an open directory descriptor and `c_segment` is valid.
                let next = unsafe {
                    libc::openat(
                        current.fd.as_raw_fd(),
                        c_segment.as_ptr(),
                        DIR_TRAVERSAL_FLAGS | libc::O_NOFOLLOW,
                    )
                };
                if next < 0 {
                    let error = io::Error::last_os_error();
                    if !create_missing && error.raw_os_error() == Some(libc::ENOENT) {
                        return Ok(None);
                    }
                    if is_symlink_open_error(error.raw_os_error()) {
                        return Err(ContainedFsError::Containment(format!(
                            "refusing to follow symlink at directory component \"{}\"",
                            segment.to_string_lossy()
                        )));
                    }
                    return Err(ContainedFsError::Io(error));
                }
                // SAFETY: `next` is a newly opened valid file descriptor.
                current = Self {
                    fd: unsafe { OwnedFd::from_raw_fd(next) },
                };
            }
            Ok(Some(current))
        }

        /// Rejects `file_name` if it already exists in this directory as a symlink.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid
        /// or refers to a symlink.
        pub fn reject_symlink(&self, file_name: &OsStr) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let _ = self.inspect_entry(file_name)?;
            Ok(())
        }

        /// Returns the on-disk identity of `file_name` inside this directory, or
        /// `None` if it does not exist.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is a symlink.
        pub fn file_identity(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<FileIdentity>, ContainedFsError> {
            validate_single_file_name(file_name)?;
            Ok(self.inspect_entry(file_name)?.map(|entry| entry.identity))
        }

        /// Reads `file_name` directly from this directory without following symlinks.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is a symlink,
        /// or [`ContainedFsError::Io`] on OS read failures.
        pub fn read_optional_file(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<String>, ContainedFsError> {
            validate_single_file_name(file_name)?;
            let c_name = os_str_to_cstring(file_name)?;
            // SAFETY: `self.fd` is an open directory descriptor and `c_name` is valid.
            let raw = unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    c_name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if raw < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ENOENT) {
                    return Ok(None);
                }
                if is_symlink_open_error(error.raw_os_error()) {
                    return Err(ContainedFsError::Containment(format!(
                        "refusing to follow symlink \"{}\"",
                        file_name.to_string_lossy()
                    )));
                }
                return Err(ContainedFsError::Io(error));
            }
            // SAFETY: `raw` is a newly opened valid file descriptor.
            let mut file = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            Ok(Some(content))
        }

        /// Writes `bytes` to a fresh temporary file inside this directory and
        /// atomically replaces `file_name`.
        ///
        /// When replacing an existing file, write permission on the existing
        /// destination is verified without truncating it, the temporary file is
        /// created as `0600`, populated, ownership/group, mode bits, and
        /// extended ACLs are restored, and only then is the temporary file
        /// synced (when requested) and atomically renamed into place. If the
        /// original principals or ACLs cannot be preserved safely, replacement
        /// fails without modifying the destination.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid
        /// or refers to a symlink, or [`ContainedFsError::Io`] on OS errors.
        pub fn write_file_atomically(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
            new_file_mode: ContainedNewFileMode,
            durability: ContainedWriteDurability,
        ) -> Result<ContainedWriteOutcome, ContainedFsError> {
            validate_single_file_name(file_name)?;
            let existing = self.open_existing_for_replace(file_name)?;
            let c_target = os_str_to_cstring(file_name)?;

            let create_mode: libc::c_uint = match (&existing, new_file_mode) {
                (None, ContainedNewFileMode::RespectUmask) => 0o666,
                _ => 0o600,
            };
            let (temp_name, mut temp_file) = self.create_temp_file(create_mode)?;
            let write_result = (|| -> io::Result<()> {
                temp_file.write_all(bytes)?;
                temp_file.flush()?;
                if let Some(existing) = existing.as_ref() {
                    restore_existing_metadata(temp_file.as_raw_fd(), existing)?;
                }
                if durability.syncs_file() {
                    temp_file.sync_all()?;
                }
                Ok(())
            })();
            drop(temp_file);

            if let Err(error) = write_result {
                let _ = self.unlink_temp(&temp_name);
                return Err(ContainedFsError::Io(error));
            }

            // SAFETY: `self.fd` is an open directory descriptor and both C strings are valid.
            let rc = unsafe {
                libc::renameat(
                    self.fd.as_raw_fd(),
                    temp_name.as_ptr(),
                    self.fd.as_raw_fd(),
                    c_target.as_ptr(),
                )
            };
            if rc != 0 {
                let error = io::Error::last_os_error();
                let _ = self.unlink_temp(&temp_name);
                return Err(ContainedFsError::Io(error));
            }
            if durability == ContainedWriteDurability::Full
                && let Err(error) = self.sync_directory()
            {
                return Ok(ContainedWriteOutcome::CommittedWithoutDirSync(error));
            }
            Ok(ContainedWriteOutcome::Committed)
        }

        /// Flushes directory metadata for this pinned directory handle to disk.
        ///
        /// # Errors
        ///
        /// Returns an [`io::Error`] when a readable descriptor cannot be opened
        /// for the directory or `fsync` fails.
        pub fn sync_directory(&self) -> io::Result<()> {
            if USES_SEARCH_ONLY_DIR_HANDLE {
                // Search-only descriptors (`O_PATH` on Linux, `O_SEARCH` on
                // macOS/BSD) do not accept `fsync`. Open a readable handle to
                // the same pinned directory and return the open error directly
                // if that fails rather than masking it behind `EBADF`.
                let dot = c".";
                // SAFETY: `self.fd` is an open directory descriptor and `dot` is a valid C string.
                let raw = unsafe {
                    libc::openat(
                        self.fd.as_raw_fd(),
                        dot.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                    )
                };
                if raw < 0 {
                    return Err(io::Error::last_os_error());
                }
                // SAFETY: `raw` is a newly opened valid file descriptor.
                let readable = unsafe { OwnedFd::from_raw_fd(raw) };
                // SAFETY: `readable` is an open directory descriptor.
                if unsafe { libc::fsync(readable.as_raw_fd()) } != 0 {
                    return Err(io::Error::last_os_error());
                }
            } else {
                // SAFETY: `self.fd` is an open readable directory descriptor.
                if unsafe { libc::fsync(self.fd.as_raw_fd()) } != 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            Ok(())
        }

        fn open_existing_for_replace(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<ExistingTarget>, ContainedFsError> {
            let c_name = os_str_to_cstring(file_name)?;
            // Open without `O_TRUNC` so existing file write permissions (for
            // example `0444`) are honored without modifying the file, symlinks
            // are rejected atomically, and metadata + ACLs are read from the
            // exact pinned inode.
            // SAFETY: `self.fd` is an open directory descriptor and `c_name` is valid.
            let raw = unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    c_name.as_ptr(),
                    libc::O_WRONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
                )
            };
            if raw < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ENOENT) {
                    return Ok(None);
                }
                if is_symlink_open_error(error.raw_os_error()) {
                    return Err(ContainedFsError::Containment(format!(
                        "refusing to write through symlink \"{}\"",
                        file_name.to_string_lossy()
                    )));
                }
                return Err(ContainedFsError::Io(error));
            }
            // SAFETY: `raw` is a newly opened valid file descriptor.
            let existing_fd = unsafe { OwnedFd::from_raw_fd(raw) };
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            // SAFETY: `existing_fd` is open and `stat` is writable.
            if unsafe { libc::fstat(existing_fd.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            // SAFETY: `fstat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            if (stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "refusing to replace non-regular file \"{}\"",
                        file_name.to_string_lossy()
                    ),
                )));
            }
            #[allow(clippy::unnecessary_cast)]
            let identity = FileIdentity {
                dev: stat.st_dev as u64,
                ino: stat.st_ino as u64,
            };
            let entry = ExistingEntry {
                mode: stat.st_mode & 0o7777,
                uid: stat.st_uid,
                gid: stat.st_gid,
                identity,
            };
            let acl = read_existing_acl(existing_fd.as_raw_fd())?;
            Ok(Some(ExistingTarget { entry, acl }))
        }

        fn inspect_entry(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<ExistingEntry>, ContainedFsError> {
            let c_name = os_str_to_cstring(file_name)?;
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            // SAFETY: `self.fd` is open, `c_name` is valid, and `stat` is writable.
            let rc = unsafe {
                libc::fstatat(
                    self.fd.as_raw_fd(),
                    c_name.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            if rc != 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ENOENT) {
                    return Ok(None);
                }
                return Err(ContainedFsError::Io(error));
            }
            // SAFETY: `fstatat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            if (stat.st_mode & libc::S_IFMT) == libc::S_IFLNK {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to write through symlink \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            #[allow(clippy::unnecessary_cast)]
            let identity = FileIdentity {
                dev: stat.st_dev as u64,
                ino: stat.st_ino as u64,
            };
            Ok(Some(ExistingEntry {
                mode: stat.st_mode & 0o7777,
                uid: stat.st_uid,
                gid: stat.st_gid,
                identity,
            }))
        }

        fn create_temp_file(
            &self,
            mode: libc::c_uint,
        ) -> Result<(CString, File), ContainedFsError> {
            let pid = std::process::id();
            for _ in 0..128 {
                let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                let name = OsString::from(format!(".pmds-tmp-{pid}-{nonce}"));
                let c_name = os_str_to_cstring(&name)?;
                // SAFETY: `self.fd` is open, `c_name` is valid, and `mode` is promoted to `c_uint`.
                let raw = unsafe {
                    libc::openat(
                        self.fd.as_raw_fd(),
                        c_name.as_ptr(),
                        libc::O_WRONLY
                            | libc::O_CREAT
                            | libc::O_EXCL
                            | libc::O_NOFOLLOW
                            | libc::O_CLOEXEC,
                        mode,
                    )
                };
                if raw >= 0 {
                    // SAFETY: `raw` is a newly opened valid file descriptor.
                    return Ok((c_name, File::from(unsafe { OwnedFd::from_raw_fd(raw) })));
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::EEXIST) {
                    return Err(ContainedFsError::Io(error));
                }
            }
            Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "could not allocate a unique temporary file in destination directory",
            )))
        }

        fn unlink_temp(&self, temp_name: &CString) -> io::Result<()> {
            // SAFETY: `self.fd` is an open directory descriptor and `temp_name` is valid.
            let rc = unsafe { libc::unlinkat(self.fd.as_raw_fd(), temp_name.as_ptr(), 0) };
            if rc == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        }
    }

    fn is_symlink_open_error(raw_os_error: Option<i32>) -> bool {
        #[cfg(target_os = "freebsd")]
        if raw_os_error == Some(libc::EMLINK) {
            return true;
        }
        #[cfg(target_os = "netbsd")]
        if raw_os_error == Some(libc::EFTYPE) {
            return true;
        }
        raw_os_error == Some(libc::ELOOP)
    }

    #[cfg(target_os = "linux")]
    fn read_linux_xattr(
        fd: std::os::fd::RawFd,
        name: &std::ffi::CStr,
    ) -> io::Result<Option<Vec<u8>>> {
        for _ in 0..4 {
            // SAFETY: querying xattr size with null buffer.
            let size = unsafe { libc::fgetxattr(fd, name.as_ptr(), std::ptr::null_mut(), 0) };
            if size < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.raw_os_error(),
                    Some(libc::ENODATA | libc::ENOTSUP | libc::EOPNOTSUPP)
                ) {
                    return Ok(None);
                }
                return Err(error);
            }
            if size == 0 {
                return Ok(None);
            }
            let mut buffer = vec![0u8; usize::try_from(size).unwrap_or(0)];
            // SAFETY: `buffer` has `buffer.len()` writable bytes.
            let read = unsafe {
                libc::fgetxattr(
                    fd,
                    name.as_ptr(),
                    buffer.as_mut_ptr().cast::<libc::c_void>(),
                    buffer.len(),
                )
            };
            if read < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ERANGE) {
                    continue;
                }
                if error.raw_os_error() == Some(libc::ENODATA) {
                    return Ok(None);
                }
                return Err(error);
            }
            buffer.truncate(usize::try_from(read).unwrap_or(0));
            return Ok(Some(buffer));
        }
        Err(io::Error::other(
            "extended attribute size changed repeatedly while reading destination ACL",
        ))
    }

    #[cfg(target_os = "linux")]
    fn read_existing_acl(fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        let posix_access = read_linux_xattr(fd, c"system.posix_acl_access")?;
        let nfs4 = read_linux_xattr(fd, c"system.nfs4_acl")?;
        if posix_access.is_none() && nfs4.is_none() {
            Ok(None)
        } else {
            Ok(Some(ExistingAcl { posix_access, nfs4 }))
        }
    }

    #[cfg(target_os = "linux")]
    fn apply_existing_acl(temp_fd: std::os::fd::RawFd, acl: &ExistingAcl) -> io::Result<()> {
        if let Some(bytes) = &acl.posix_access {
            // SAFETY: `temp_fd` is open and `bytes` is a valid buffer.
            if unsafe {
                libc::fsetxattr(
                    temp_fd,
                    c"system.posix_acl_access".as_ptr(),
                    bytes.as_ptr().cast::<libc::c_void>(),
                    bytes.len(),
                    0,
                )
            } != 0
            {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("cannot preserve POSIX ACL on replacement: {error}"),
                ));
            }
        }
        if let Some(bytes) = &acl.nfs4 {
            // SAFETY: `temp_fd` is open and `bytes` is a valid buffer.
            if unsafe {
                libc::fsetxattr(
                    temp_fd,
                    c"system.nfs4_acl".as_ptr(),
                    bytes.as_ptr().cast::<libc::c_void>(),
                    bytes.len(),
                    0,
                )
            } != 0
            {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("cannot preserve NFSv4 ACL on replacement: {error}"),
                ));
            }
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn read_existing_acl(fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        // SAFETY: `fd` is an open file descriptor.
        let raw = unsafe { macos_acl::acl_get_fd_np(fd, macos_acl::ACL_TYPE_EXTENDED) };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if matches!(
                error.raw_os_error(),
                Some(libc::ENOENT | libc::ENOTSUP | libc::EOPNOTSUPP | libc::EINVAL)
            ) {
                return Ok(None);
            }
            return Err(error);
        }
        let acl = ExistingAcl(raw);
        let mut entry: *mut libc::c_void = std::ptr::null_mut();
        // SAFETY: `acl.0` is a valid `acl_t` returned by `acl_get_fd_np`.
        if unsafe { macos_acl::acl_get_entry(acl.0, macos_acl::ACL_FIRST_ENTRY, &mut entry) } == 0 {
            Ok(Some(acl))
        } else {
            Ok(None)
        }
    }

    #[cfg(target_os = "macos")]
    fn apply_existing_acl(temp_fd: std::os::fd::RawFd, acl: &ExistingAcl) -> io::Result<()> {
        // SAFETY: `temp_fd` is open and `acl.0` is a valid `acl_t`.
        if unsafe { macos_acl::acl_set_fd_np(temp_fd, acl.0, macos_acl::ACL_TYPE_EXTENDED) } != 0 {
            let error = io::Error::last_os_error();
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("cannot preserve macOS extended ACL on replacement: {error}"),
            ));
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn read_existing_acl(_fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        Ok(None)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn apply_existing_acl(_temp_fd: std::os::fd::RawFd, _acl: &ExistingAcl) -> io::Result<()> {
        Ok(())
    }

    fn restore_existing_metadata(
        temp_fd: std::os::fd::RawFd,
        existing: &ExistingTarget,
    ) -> io::Result<()> {
        let mut temp_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `temp_fd` is an open file descriptor and `temp_stat` is writable.
        if unsafe { libc::fstat(temp_fd, temp_stat.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `fstat` succeeded and initialized `temp_stat`.
        let temp_stat = unsafe { temp_stat.assume_init() };
        let uid_differs = temp_stat.st_uid != existing.entry.uid;
        let gid_differs = temp_stat.st_gid != existing.entry.gid;
        if uid_differs || gid_differs {
            let target_uid = if uid_differs {
                existing.entry.uid
            } else {
                libc::uid_t::MAX
            };
            let target_gid = if gid_differs {
                existing.entry.gid
            } else {
                libc::gid_t::MAX
            };
            // SAFETY: `temp_fd` is an open file descriptor.
            if unsafe { libc::fchown(temp_fd, target_uid, target_gid) } != 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "cannot safely preserve original file ownership/group on replacement: {error}"
                    ),
                ));
            }
        }
        if (temp_stat.st_mode & 0o7777) != existing.entry.mode {
            // SAFETY: `temp_fd` is an open file descriptor.
            if unsafe { libc::fchmod(temp_fd, existing.entry.mode) } != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        if let Some(acl) = existing.acl.as_ref() {
            apply_existing_acl(temp_fd, acl)?;
        }
        Ok(())
    }

    fn os_str_to_cstring(value: &OsStr) -> Result<CString, ContainedFsError> {
        CString::new(value.as_bytes()).map_err(|_| {
            ContainedFsError::Containment("path component contains an interior NUL byte".to_owned())
        })
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::{OsStr, OsString, c_void};
    use std::fs::File;
    use std::io::{self, Read, Write};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, ContainedWriteOutcome,
        FileIdentity, validate_relative_dir_segments, validate_single_file_name,
    };

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    type NtStatus = i32;

    const STATUS_OBJECT_NAME_NOT_FOUND: NtStatus = 0xC000_0034_u32 as i32;
    const STATUS_OBJECT_PATH_NOT_FOUND: NtStatus = 0xC000_003A_u32 as i32;
    const STATUS_OBJECT_NAME_COLLISION: NtStatus = 0xC000_0035_u32 as i32;
    const ERROR_INVALID_FUNCTION: i32 = 1;
    const ERROR_NOT_SUPPORTED: i32 = 50;
    const ERROR_INSUFFICIENT_BUFFER: i32 = 122;

    const FILE_WRITE_DATA: u32 = 0x0000_0002;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const FILE_TRAVERSE: u32 = 0x0000_0020;
    const READ_CONTROL: u32 = 0x0002_0000;
    const DELETE: u32 = 0x0001_0000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const OPEN_EXISTING: u32 = 3;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const INVALID_HANDLE_VALUE: *mut c_void = (-1_isize) as *mut c_void;

    const FILE_OPEN: u32 = 0x0000_0001;
    const FILE_CREATE: u32 = 0x0000_0002;
    const FILE_OPEN_IF: u32 = 0x0000_0003;
    const FILE_DIRECTORY_FILE: u32 = 0x0000_0001;
    const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x0000_0020;
    const FILE_NON_DIRECTORY_FILE: u32 = 0x0000_0040;
    const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const OBJ_CASE_INSENSITIVE: u32 = 0x0000_0040;
    const FILE_RENAME_INFORMATION_CLASS: u32 = 10;
    const FILE_DISPOSITION_INFORMATION_CLASS: u32 = 13;
    const DACL_SECURITY_INFORMATION: u32 = 0x0000_0004;

    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *mut u16,
    }

    #[repr(C)]
    struct ObjectAttributes {
        length: u32,
        root_directory: *mut c_void,
        object_name: *mut UnicodeString,
        attributes: u32,
        security_descriptor: *mut c_void,
        security_quality_of_service: *mut c_void,
    }

    #[repr(C)]
    struct IoStatusBlock {
        status_or_pointer: usize,
        information: usize,
    }

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    struct FileDispositionInformation {
        delete_file: u8,
    }

    #[repr(C)]
    struct FileRenameInformation {
        replace_if_exists: u8,
        root_directory: *mut c_void,
        file_name_length: u32,
        file_name: [u16; 1],
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *mut c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: *mut c_void,
        ) -> *mut c_void;
        fn GetFileInformationByHandle(
            file: *mut c_void,
            file_information: *mut ByHandleFileInformation,
        ) -> i32;
    }

    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn GetKernelObjectSecurity(
            handle: *mut c_void,
            requested_information: u32,
            security_descriptor: *mut c_void,
            length: u32,
            length_needed: *mut u32,
        ) -> i32;
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtCreateFile(
            file_handle: *mut *mut c_void,
            desired_access: u32,
            object_attributes: *mut ObjectAttributes,
            io_status_block: *mut IoStatusBlock,
            allocation_size: *mut i64,
            file_attributes: u32,
            share_access: u32,
            create_disposition: u32,
            create_options: u32,
            ea_buffer: *mut c_void,
            ea_length: u32,
        ) -> NtStatus;
        fn NtSetInformationFile(
            file_handle: *mut c_void,
            io_status_block: *mut IoStatusBlock,
            file_information: *mut c_void,
            length: u32,
            file_information_class: u32,
        ) -> NtStatus;
        fn RtlNtStatusToDosError(status: NtStatus) -> u32;
    }

    /// Open directory handle on Windows used for strictly handle-relative child
    /// operations via `NtCreateFile` and `NtSetInformationFile`.
    #[derive(Debug)]
    pub struct ContainedDir {
        handle: OwnedHandle,
    }

    impl ContainedDir {
        /// Opens `root_dir` as the anchor directory handle.
        ///
        /// # Errors
        ///
        /// Returns an error when `root_dir` cannot be opened as a directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            let mut wide = encode_utf16_no_nul(root_dir.as_os_str())?;
            wide.push(0);
            // SAFETY: `wide` is NUL-terminated UTF-16.
            let raw = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    std::ptr::null_mut(),
                    OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS,
                    std::ptr::null_mut(),
                )
            };
            if raw == INVALID_HANDLE_VALUE {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            // SAFETY: `raw` is a newly opened valid Windows handle.
            let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
            let info = file_information(handle.as_raw_handle())?;
            if (info.file_attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::NotADirectory,
                    format!("{} is not a directory", root_dir.display()),
                )));
            }
            Ok(Self { handle })
        }

        /// Opens `relative_dir` under `root_dir` handle-relatively without
        /// following symlinks or junctions, optionally creating missing
        /// directories atomically (`FILE_OPEN_IF`).
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if any segment escapes or
        /// is a reparse point, or [`ContainedFsError::Io`] on OS errors.
        pub fn open_subpath(
            root_dir: &Path,
            relative_dir: &Path,
            create_missing: bool,
        ) -> Result<Option<Self>, ContainedFsError> {
            let segments = validate_relative_dir_segments(relative_dir)?;
            let mut current = Self::open_root(root_dir)?;
            for segment in segments {
                let disposition = if create_missing {
                    FILE_OPEN_IF
                } else {
                    FILE_OPEN
                };
                let next = match nt_create_relative(
                    current.handle.as_raw_handle(),
                    &segment,
                    FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE,
                    FILE_ATTRIBUTE_DIRECTORY,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    disposition,
                    FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                    std::ptr::null_mut(),
                ) {
                    Ok(handle) => handle,
                    Err(status) if !create_missing && is_not_found_status(status) => {
                        return Ok(None);
                    }
                    Err(status) => return Err(ContainedFsError::Io(nt_status_to_io_error(status))),
                };
                let info = file_information(next.as_raw_handle())?;
                if (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                    return Err(ContainedFsError::Containment(format!(
                        "refusing to follow symlink or junction at directory component \"{}\"",
                        segment.to_string_lossy()
                    )));
                }
                if (info.file_attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 {
                    return Err(ContainedFsError::Io(io::Error::new(
                        io::ErrorKind::NotADirectory,
                        format!("\"{}\" is not a directory", segment.to_string_lossy()),
                    )));
                }
                current = Self { handle: next };
            }
            Ok(Some(current))
        }

        /// Rejects `file_name` if it exists as a symlink or reparse point.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid
        /// or refers to a reparse point.
        pub fn reject_symlink(&self, file_name: &OsStr) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let _ = self.inspect_entry(file_name, false)?;
            Ok(())
        }

        /// Returns the on-disk file identity of `file_name` in this directory,
        /// or `None` if it does not exist.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is a
        /// symlink/reparse point.
        pub fn file_identity(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<FileIdentity>, ContainedFsError> {
            validate_single_file_name(file_name)?;
            Ok(self
                .inspect_entry(file_name, false)?
                .map(|(identity, _)| identity))
        }

        /// Reads `file_name` handle-relatively without following reparse points.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is a
        /// symlink/reparse point.
        pub fn read_optional_file(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<String>, ContainedFsError> {
            validate_single_file_name(file_name)?;
            let handle = match nt_create_relative(
                self.handle.as_raw_handle(),
                file_name,
                GENERIC_READ | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                std::ptr::null_mut(),
            ) {
                Ok(handle) => handle,
                Err(status) if is_not_found_status(status) => return Ok(None),
                Err(status) => return Err(ContainedFsError::Io(nt_status_to_io_error(status))),
            };
            let info = file_information(handle.as_raw_handle())?;
            if (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to follow symlink \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            let mut file = File::from(handle);
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            Ok(Some(content))
        }

        /// Atomically writes `bytes` to `file_name` inside this directory
        /// handle, verifying write access on any existing file and preserving
        /// its DACL from the moment the temporary file is created.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is a
        /// symlink/reparse point, or [`ContainedFsError::Io`] on OS errors.
        pub fn write_file_atomically(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
            _new_file_mode: ContainedNewFileMode,
            durability: ContainedWriteDurability,
        ) -> Result<ContainedWriteOutcome, ContainedFsError> {
            validate_single_file_name(file_name)?;
            let mut existing_dacl = self
                .inspect_entry(file_name, true)?
                .and_then(|(_, dacl)| dacl);
            let security_descriptor = existing_dacl
                .as_mut()
                .map_or(std::ptr::null_mut(), |buffer| {
                    buffer.as_mut_ptr().cast::<c_void>()
                });

            let mut temp_file = self.create_temp_file(security_descriptor)?;
            let write_result = (|| -> io::Result<()> {
                temp_file.write_all(bytes)?;
                temp_file.flush()?;
                if durability.syncs_file() {
                    temp_file.sync_all()?;
                }
                nt_rename_relative(
                    temp_file.as_raw_handle(),
                    self.handle.as_raw_handle(),
                    file_name,
                )
            })();
            if let Err(error) = write_result {
                let _ = nt_mark_delete_on_close(temp_file.as_raw_handle());
                return Err(ContainedFsError::Io(error));
            }
            Ok(ContainedWriteOutcome::Committed)
        }

        /// Flushes directory metadata (no-op on Windows where file sync provides durability).
        pub fn sync_directory(&self) -> io::Result<()> {
            Ok(())
        }

        fn inspect_entry(
            &self,
            file_name: &OsStr,
            for_replace: bool,
        ) -> Result<Option<(FileIdentity, Option<Vec<usize>>)>, ContainedFsError> {
            let access = if for_replace {
                FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE
            } else {
                FILE_READ_ATTRIBUTES | SYNCHRONIZE
            };
            let handle = match nt_create_relative(
                self.handle.as_raw_handle(),
                file_name,
                access,
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                std::ptr::null_mut(),
            ) {
                Ok(handle) => handle,
                Err(status) if is_not_found_status(status) => return Ok(None),
                Err(status) => return Err(ContainedFsError::Io(nt_status_to_io_error(status))),
            };
            let info = file_information(handle.as_raw_handle())?;
            if (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to write through symlink \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            let dacl = if for_replace {
                read_dacl_security_descriptor(handle.as_raw_handle())?
            } else {
                None
            };
            Ok(Some((
                FileIdentity {
                    volume_serial: info.volume_serial_number,
                    file_index_high: info.file_index_high,
                    file_index_low: info.file_index_low,
                },
                dacl,
            )))
        }

        fn create_temp_file(
            &self,
            security_descriptor: *mut c_void,
        ) -> Result<File, ContainedFsError> {
            let pid = std::process::id();
            for _ in 0..128 {
                let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                let name = OsString::from(format!(".pmds-tmp-{pid}-{nonce}"));
                match nt_create_relative(
                    self.handle.as_raw_handle(),
                    &name,
                    GENERIC_WRITE | DELETE | SYNCHRONIZE,
                    FILE_ATTRIBUTE_NORMAL,
                    0,
                    FILE_CREATE,
                    FILE_NON_DIRECTORY_FILE
                        | FILE_OPEN_REPARSE_POINT
                        | FILE_SYNCHRONOUS_IO_NONALERT,
                    security_descriptor,
                ) {
                    Ok(handle) => return Ok(File::from(handle)),
                    Err(STATUS_OBJECT_NAME_COLLISION) => continue,
                    Err(status) => return Err(ContainedFsError::Io(nt_status_to_io_error(status))),
                }
            }
            Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "could not allocate a unique temporary file in destination directory",
            )))
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn nt_create_relative(
        root_handle: *mut c_void,
        name: &OsStr,
        desired_access: u32,
        file_attributes: u32,
        share_access: u32,
        create_disposition: u32,
        create_options: u32,
        security_descriptor: *mut c_void,
    ) -> Result<OwnedHandle, NtStatus> {
        let mut wide = encode_utf16_no_nul(name).map_err(|_| STATUS_OBJECT_PATH_NOT_FOUND)?;
        let byte_len = u16::try_from(wide.len().saturating_mul(2))
            .map_err(|_| STATUS_OBJECT_PATH_NOT_FOUND)?;
        let mut unicode = UnicodeString {
            length: byte_len,
            maximum_length: byte_len,
            buffer: wide.as_mut_ptr(),
        };
        let mut attributes = ObjectAttributes {
            length: u32::try_from(std::mem::size_of::<ObjectAttributes>()).unwrap_or(0),
            root_directory: root_handle,
            object_name: &mut unicode,
            attributes: OBJ_CASE_INSENSITIVE,
            security_descriptor,
            security_quality_of_service: std::ptr::null_mut(),
        };
        let mut iosb = IoStatusBlock {
            status_or_pointer: 0,
            information: 0,
        };
        let mut handle: *mut c_void = std::ptr::null_mut();
        // SAFETY: all pointers remain valid for the duration of `NtCreateFile`.
        let status = unsafe {
            NtCreateFile(
                &mut handle,
                desired_access,
                &mut attributes,
                &mut iosb,
                std::ptr::null_mut(),
                file_attributes,
                share_access,
                create_disposition,
                create_options,
                std::ptr::null_mut(),
                0,
            )
        };
        if status < 0 {
            return Err(status);
        }
        // SAFETY: `NtCreateFile` succeeded and returned a newly opened handle.
        Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
    }

    fn nt_rename_relative(
        file_handle: *mut c_void,
        root_directory: *mut c_void,
        target_name: &OsStr,
    ) -> io::Result<()> {
        let wide = encode_utf16_no_nul(target_name).map_err(ContainedFsError::into_io_error)?;
        let name_bytes_len = u32::try_from(wide.len().saturating_mul(2)).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "destination filename too long")
        })?;
        let name_offset = std::mem::offset_of!(FileRenameInformation, file_name);
        let total_size = (name_offset + usize::try_from(name_bytes_len).unwrap_or(0))
            .max(std::mem::size_of::<FileRenameInformation>());
        // Ensure pointer alignment for `FileRenameInformation`.
        let word_count = total_size.div_ceil(std::mem::size_of::<usize>());
        let mut storage = vec![0usize; word_count];
        let ptr = storage.as_mut_ptr().cast::<u8>();
        // SAFETY: `storage` is zero-initialized, aligned for `usize` (and thus
        // `FileRenameInformation`), and large enough to hold all fields plus
        // the UTF-16 filename bytes starting at `name_offset`.
        unsafe {
            let info = ptr.cast::<FileRenameInformation>();
            std::ptr::addr_of_mut!((*info).replace_if_exists).write(1);
            std::ptr::addr_of_mut!((*info).root_directory).write(root_directory);
            std::ptr::addr_of_mut!((*info).file_name_length).write(name_bytes_len);
            std::ptr::copy_nonoverlapping(
                wide.as_ptr().cast::<u8>(),
                ptr.add(name_offset),
                usize::try_from(name_bytes_len).unwrap_or(0),
            );
        }
        let mut iosb = IoStatusBlock {
            status_or_pointer: 0,
            information: 0,
        };
        // SAFETY: `file_handle` and `storage` are valid for `total_size` bytes.
        let status = unsafe {
            NtSetInformationFile(
                file_handle,
                &mut iosb,
                ptr.cast::<c_void>(),
                u32::try_from(total_size).unwrap_or(u32::MAX),
                FILE_RENAME_INFORMATION_CLASS,
            )
        };
        if status < 0 {
            return Err(nt_status_to_io_error(status));
        }
        Ok(())
    }

    fn nt_mark_delete_on_close(file_handle: *mut c_void) -> io::Result<()> {
        let mut disposition = FileDispositionInformation { delete_file: 1 };
        let mut iosb = IoStatusBlock {
            status_or_pointer: 0,
            information: 0,
        };
        // SAFETY: `file_handle` is open and `disposition` has the required size.
        let status = unsafe {
            NtSetInformationFile(
                file_handle,
                &mut iosb,
                (&mut disposition as *mut FileDispositionInformation).cast::<c_void>(),
                u32::try_from(std::mem::size_of::<FileDispositionInformation>()).unwrap_or(1),
                FILE_DISPOSITION_INFORMATION_CLASS,
            )
        };
        if status < 0 {
            return Err(nt_status_to_io_error(status));
        }
        Ok(())
    }

    fn read_dacl_security_descriptor(
        handle: *mut c_void,
    ) -> Result<Option<Vec<usize>>, ContainedFsError> {
        let mut needed: u32 = 0;
        // SAFETY: querying required buffer size with null output pointer.
        let ok = unsafe {
            GetKernelObjectSecurity(
                handle,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                0,
                &mut needed,
            )
        };
        if ok != 0 {
            return Ok(None);
        }
        let error = io::Error::last_os_error();
        if matches!(
            error.raw_os_error(),
            Some(ERROR_INVALID_FUNCTION | ERROR_NOT_SUPPORTED)
        ) {
            return Ok(None);
        }
        if error.raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER) || needed == 0 {
            return Err(ContainedFsError::Io(error));
        }
        let word_count = usize::try_from(needed)
            .unwrap_or(0)
            .div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0usize; word_count];
        // SAFETY: `buffer` is pointer-aligned and has at least `needed` writable bytes.
        let ok = unsafe {
            GetKernelObjectSecurity(
                handle,
                DACL_SECURITY_INFORMATION,
                buffer.as_mut_ptr().cast::<c_void>(),
                needed,
                &mut needed,
            )
        };
        if ok == 0 {
            return Err(ContainedFsError::Io(io::Error::last_os_error()));
        }
        Ok(Some(buffer))
    }

    fn file_information(handle: *mut c_void) -> Result<ByHandleFileInformation, ContainedFsError> {
        let mut info = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
        // SAFETY: `handle` is open and `info` is writable.
        let ok = unsafe { GetFileInformationByHandle(handle, info.as_mut_ptr()) };
        if ok == 0 {
            return Err(ContainedFsError::Io(io::Error::last_os_error()));
        }
        // SAFETY: `GetFileInformationByHandle` succeeded and initialized `info`.
        Ok(unsafe { info.assume_init() })
    }

    fn encode_utf16_no_nul(value: &OsStr) -> Result<Vec<u16>, ContainedFsError> {
        let wide: Vec<u16> = value.encode_wide().collect();
        if wide.contains(&0) {
            return Err(ContainedFsError::Containment(
                "path component contains an interior NUL byte".to_owned(),
            ));
        }
        Ok(wide)
    }

    const fn is_not_found_status(status: NtStatus) -> bool {
        status == STATUS_OBJECT_NAME_NOT_FOUND || status == STATUS_OBJECT_PATH_NOT_FOUND
    }

    fn nt_status_to_io_error(status: NtStatus) -> io::Error {
        // SAFETY: pure conversion from NTSTATUS to Win32 error code.
        let dos_error = unsafe { RtlNtStatusToDosError(status) };
        io::Error::from_raw_os_error(i32::try_from(dos_error).unwrap_or(1))
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use std::ffi::OsStr;
    use std::fs;
    use std::io::{self, Write};
    use std::path::{Path, PathBuf};

    use super::{
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, ContainedWriteOutcome,
        FileIdentity, validate_relative_dir_segments, validate_single_file_name,
    };

    /// Verified directory handle fallback for platforms without Unix/Windows APIs.
    #[derive(Debug)]
    pub struct ContainedDir {
        dir: PathBuf,
    }

    impl ContainedDir {
        /// Opens `root_dir` as the anchor directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            Ok(Self {
                dir: fs::canonicalize(root_dir)?,
            })
        }

        /// Opens `relative_dir` under `root_dir` without following symlinks.
        pub fn open_subpath(
            root_dir: &Path,
            relative_dir: &Path,
            create_missing: bool,
        ) -> Result<Option<Self>, ContainedFsError> {
            let segments = validate_relative_dir_segments(relative_dir)?;
            let canonical_root = fs::canonicalize(root_dir)?;
            let mut current = canonical_root.clone();
            for segment in segments {
                current.push(&segment);
                if create_missing {
                    match fs::create_dir(&current) {
                        Ok(()) => {}
                        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(ContainedFsError::Io(error)),
                    }
                }
                match fs::symlink_metadata(&current) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        return Err(ContainedFsError::Containment(format!(
                            "refusing to follow symlink at directory component \"{}\"",
                            segment.to_string_lossy()
                        )));
                    }
                    Ok(_) => {}
                    Err(error) if !create_missing && error.kind() == io::ErrorKind::NotFound => {
                        return Ok(None);
                    }
                    Err(error) => return Err(ContainedFsError::Io(error)),
                }
                let canonical = fs::canonicalize(&current)?;
                if !canonical.starts_with(&canonical_root) {
                    return Err(ContainedFsError::Containment(format!(
                        "directory {} escapes root directory {}",
                        current.display(),
                        canonical_root.display()
                    )));
                }
                current = canonical;
            }
            Ok(Some(Self { dir: current }))
        }

        /// Rejects `file_name` if it exists as a symlink.
        pub fn reject_symlink(&self, file_name: &OsStr) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let path = self.dir.join(file_name);
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    Err(ContainedFsError::Containment(format!(
                        "refusing to write through symlink \"{}\"",
                        file_name.to_string_lossy()
                    )))
                }
                Ok(_) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(ContainedFsError::Io(error)),
            }
        }

        /// Unsupported file identity lookup fallback.
        pub fn file_identity(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<FileIdentity>, ContainedFsError> {
            self.reject_symlink(file_name)?;
            Ok(None)
        }

        /// Reads `file_name` if present and not a symlink.
        pub fn read_optional_file(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<String>, ContainedFsError> {
            self.reject_symlink(file_name)?;
            let path = self.dir.join(file_name);
            match fs::read_to_string(&path) {
                Ok(content) => Ok(Some(content)),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(ContainedFsError::Io(error)),
            }
        }

        /// Atomically writes `bytes` to `file_name`.
        pub fn write_file_atomically(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
            _new_file_mode: ContainedNewFileMode,
            durability: ContainedWriteDurability,
        ) -> Result<ContainedWriteOutcome, ContainedFsError> {
            self.reject_symlink(file_name)?;
            let destination = self.dir.join(file_name);
            let mut temporary = tempfile::NamedTempFile::new_in(&self.dir)?;
            temporary.write_all(bytes)?;
            temporary.flush()?;
            if durability.syncs_file() {
                temporary.as_file().sync_all()?;
            }
            temporary
                .persist(&destination)
                .map_err(|error| ContainedFsError::Io(error.error))?;
            Ok(ContainedWriteOutcome::Committed)
        }

        /// Flushes directory metadata (no-op on fallback targets).
        pub fn sync_directory(&self) -> io::Result<()> {
            Ok(())
        }
    }
}

pub use platform::ContainedDir;

#[cfg(all(test, unix))]
mod tests {
    use std::ffi::OsStr;
    use std::fs;
    use std::io;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use super::{
        ContainedDir, ContainedFsError, ContainedNewFileMode, ContainedWriteDurability,
        ContainedWriteOutcome,
    };

    #[test]
    fn traverses_search_only_unix_directories_for_reads_and_writes() {
        let root = tempfile::tempdir().expect("temp dir");
        let hidden = root.path().join("restricted");
        let leaf = hidden.join("locales");
        fs::create_dir_all(&leaf).expect("create directories");
        fs::write(leaf.join("en.po"), "hello").expect("write catalog");
        // Make intermediate directory execute-only (searchable, not listable).
        fs::set_permissions(&hidden, fs::Permissions::from_mode(0o111)).expect("chmod search-only");

        let dir = ContainedDir::open_subpath(root.path(), Path::new("restricted/locales"), false)
            .expect("traverse search-only directory")
            .expect("directory exists");
        assert_eq!(
            dir.read_optional_file(OsStr::new("en.po"))
                .expect("read through search-only directory")
                .as_deref(),
            Some("hello")
        );
        let outcome = dir
            .write_file_atomically(
                OsStr::new("de.po"),
                b"hallo",
                ContainedNewFileMode::Private,
                ContainedWriteDurability::Full,
            )
            .expect("write and sync under search-only parent");
        assert!(matches!(outcome, ContainedWriteOutcome::Committed));
        assert_eq!(
            dir.read_optional_file(OsStr::new("de.po"))
                .expect("read written file")
                .as_deref(),
            Some("hallo")
        );

        // Restore permissions so TempDir cleanup succeeds cleanly.
        fs::set_permissions(&hidden, fs::Permissions::from_mode(0o755))
            .expect("restore permissions");
    }

    #[test]
    fn refuses_to_overwrite_read_only_existing_file_for_unprivileged_owner() {
        let root = tempfile::tempdir().expect("temp dir");
        let target = root.path().join("en.mjs");
        fs::write(&target, "original").expect("seed file");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o444)).expect("chmod 0444");

        // Skip when running as root (CAP_DAC_OVERRIDE bypasses 0444 checks).
        if fs::OpenOptions::new().write(true).open(&target).is_ok() {
            fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).expect("restore");
            return;
        }

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        let error = dir
            .write_file_atomically(
                OsStr::new("en.mjs"),
                b"overwritten",
                ContainedNewFileMode::RespectUmask,
                ContainedWriteDurability::Rename,
            )
            .expect_err("read-only existing file must not be overwritten");
        assert!(
            matches!(&error, ContainedFsError::Io(io_err) if io_err.kind() == io::ErrorKind::PermissionDenied),
            "unexpected error: {error}"
        );
        assert_eq!(
            fs::read_to_string(&target).expect("read original"),
            "original"
        );
        fs::set_permissions(&target, fs::Permissions::from_mode(0o644)).expect("restore");
    }

    #[test]
    fn full_write_reports_when_directory_cannot_be_synced() {
        let root = tempfile::tempdir().expect("temp dir");
        let leaf = root.path().join("write-only-dir");
        fs::create_dir_all(&leaf).expect("create dir");
        // Searchable + writable, but not readable: rename commits, opening "." O_RDONLY fails.
        fs::set_permissions(&leaf, fs::Permissions::from_mode(0o311)).expect("chmod 0311");

        // Skip when running as root or on targets whose dir handle is already O_RDONLY.
        if fs::read_dir(&leaf).is_ok() {
            fs::set_permissions(&leaf, fs::Permissions::from_mode(0o755)).expect("restore");
            return;
        }

        let dir = ContainedDir::open_subpath(root.path(), Path::new("write-only-dir"), false)
            .expect("open search-only leaf")
            .expect("exists");
        let outcome = dir
            .write_file_atomically(
                OsStr::new("out.fcl"),
                b"payload",
                ContainedNewFileMode::Private,
                ContainedWriteDurability::Full,
            )
            .expect("rename commits visibly even when directory sync fails");
        assert!(
            matches!(outcome, ContainedWriteOutcome::CommittedWithoutDirSync(_)),
            "expected CommittedWithoutDirSync, got {outcome:?}"
        );
        assert_eq!(
            fs::read_to_string(leaf.join("out.fcl")).expect("read committed file"),
            "payload"
        );

        fs::set_permissions(&leaf, fs::Permissions::from_mode(0o755)).expect("restore");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn preserves_macos_extended_acl_across_atomic_replacement() {
        use std::process::Command;

        let root = tempfile::tempdir().expect("temp dir");
        let target = root.path().join("en.mjs");
        fs::write(&target, "before").expect("seed file");

        let status = Command::new("/bin/chmod")
            .args(["+a", "everyone allow read"])
            .arg(&target)
            .status()
            .expect("invoke /bin/chmod +a");
        if !status.success() {
            // Skip if the temp filesystem does not support macOS ACLs.
            return;
        }

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        dir.write_file_atomically(
            OsStr::new("en.mjs"),
            b"after",
            ContainedNewFileMode::RespectUmask,
            ContainedWriteDurability::Rename,
        )
        .expect("atomic replacement with ACL succeeds");
        assert_eq!(fs::read_to_string(&target).expect("read replaced"), "after");

        let ls = Command::new("/bin/ls")
            .args(["-le"])
            .arg(&target)
            .output()
            .expect("invoke /bin/ls -le");
        let stdout = String::from_utf8_lossy(&ls.stdout);
        assert!(
            stdout.contains("everyone allow read"),
            "expected preserved macOS ACL in `ls -le` output, got:\n{stdout}"
        );
    }
}
