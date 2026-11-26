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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
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
    use std::collections::hash_map::RandomState;
    use std::ffi::{CString, OsStr, OsString};
    use std::fs::File;
    use std::hash::{BuildHasher, Hasher};
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

    #[derive(Clone, Copy, PartialEq, Eq)]
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
    #[derive(PartialEq, Eq)]
    struct ExistingAcl {
        posix_access: Option<Vec<u8>>,
        nfs4: Option<Vec<u8>>,
        selinux_label: Option<Vec<u8>>,
    }

    #[cfg(target_os = "macos")]
    struct ExistingAcl(*mut libc::c_void);

    #[cfg(target_os = "macos")]
    impl Drop for ExistingAcl {
        fn drop(&mut self) {
            // SAFETY: `self.0` was returned by `acl_get_fd_np`/`acl_init` and has not been freed.
            unsafe {
                let _ = macos_acl::acl_free(self.0);
            }
        }
    }

    #[cfg(target_os = "freebsd")]
    struct ExistingAcl {
        acl_type: libc::c_int,
        ptr: *mut libc::c_void,
    }

    #[cfg(target_os = "freebsd")]
    impl Drop for ExistingAcl {
        fn drop(&mut self) {
            // SAFETY: `self.ptr` was returned by FreeBSD ACL APIs and has not been freed.
            unsafe {
                let _ = freebsd_acl::acl_free(self.ptr);
            }
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "freebsd")))]
    struct ExistingAcl;

    #[cfg(target_os = "macos")]
    mod macos_acl {
        pub(super) const ACL_TYPE_EXTENDED: libc::c_int = 0x0000_0100;
        pub(super) const ACL_FIRST_ENTRY: libc::c_int = 0;
        pub(super) const RENAME_EXCL: libc::c_uint = 0x0000_0004;

        unsafe extern "C" {
            pub(super) fn acl_init(count: libc::c_int) -> *mut libc::c_void;
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
            pub(super) fn acl_size(acl: *mut libc::c_void) -> libc::ssize_t;
            pub(super) fn acl_copy_ext_native(
                buf_p: *mut libc::c_void,
                acl: *mut libc::c_void,
                size: libc::ssize_t,
            ) -> libc::ssize_t;
            pub(super) fn acl_free(obj_p: *mut libc::c_void) -> libc::c_int;
            pub(super) fn renameatx_np(
                fromfd: libc::c_int,
                from: *const libc::c_char,
                tofd: libc::c_int,
                to: *const libc::c_char,
                flags: libc::c_uint,
            ) -> libc::c_int;
        }
    }

    #[cfg(target_os = "freebsd")]
    mod freebsd_acl {
        pub(super) const ACL_TYPE_ACCESS: libc::c_int = 0x0000_0002;
        pub(super) const ACL_TYPE_NFS4: libc::c_int = 0x0000_0004;

        unsafe extern "C" {
            pub(super) fn acl_get_fd_np(fd: libc::c_int, type_: libc::c_int) -> *mut libc::c_void;
            pub(super) fn acl_set_fd_np(
                fd: libc::c_int,
                acl: *mut libc::c_void,
                type_: libc::c_int,
            ) -> libc::c_int;
            pub(super) fn acl_is_trivial_np(
                acl: *mut libc::c_void,
                trivialp: *mut libc::c_int,
            ) -> libc::c_int;
            pub(super) fn acl_strip_np(
                acl: *mut libc::c_void,
                recalculate_mask: libc::c_int,
            ) -> *mut libc::c_void;
            pub(super) fn acl_to_text_np(
                acl: *mut libc::c_void,
                len_p: *mut libc::ssize_t,
                flags: libc::c_int,
            ) -> *mut libc::c_char;
            pub(super) fn acl_free(obj_p: *mut libc::c_void) -> libc::c_int;
        }
    }

    struct UnixTempFileGuard<'a> {
        dir: &'a ContainedDir,
        name: CString,
        armed: bool,
    }

    impl<'a> UnixTempFileGuard<'a> {
        fn new(dir: &'a ContainedDir, name: CString) -> Self {
            Self {
                dir,
                name,
                armed: true,
            }
        }

        fn disarm(&mut self) {
            self.armed = false;
        }
    }

    impl Drop for UnixTempFileGuard<'_> {
        fn drop(&mut self) {
            if self.armed {
                let _ = self.dir.unlink_temp(&self.name);
            }
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
                    if is_symlink_open_error(error.raw_os_error())
                        || (error.raw_os_error() == Some(libc::ENOTDIR)
                            && current.is_symlink_entry(&c_segment))
                    {
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

        /// Writes `bytes` in place to `file_name` through this verified
        /// directory handle without following symlinks or overwriting hard
        /// links.
        ///
        /// On first creation the kernel applies the destination directory's
        /// native umask, `setgid` group, and default/inheritable ACLs directly.
        /// On update, writing to the existing inode preserves live permissions,
        /// ownership, ACLs, and SELinux labels with no rename-time metadata
        /// window. Hard-linked destinations (`st_nlink > 1`) are rejected
        /// before truncation so external links cannot be modified.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// refers to a symlink, or has multiple hard links, or
        /// [`ContainedFsError::Io`] on OS errors.
        pub fn write_file_in_place(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let c_target = os_str_to_cstring(file_name)?;
            // SAFETY: `self.fd` is an open directory descriptor and `c_target` is valid.
            let raw = unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    c_target.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_NOFOLLOW
                        | libc::O_NONBLOCK
                        | libc::O_CLOEXEC,
                    0o666 as libc::c_uint,
                )
            };
            if raw < 0 {
                let error = io::Error::last_os_error();
                if is_symlink_open_error(error.raw_os_error()) {
                    return Err(ContainedFsError::Containment(format!(
                        "refusing to write through symlink \"{}\"",
                        file_name.to_string_lossy()
                    )));
                }
                return Err(ContainedFsError::Io(error));
            }
            // SAFETY: `raw` is a newly opened valid file descriptor.
            let mut file = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            // SAFETY: `file` is open and `stat` is writable.
            if unsafe { libc::fstat(file.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            // SAFETY: `fstat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            if (stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!(
                        "refusing to write non-regular file \"{}\"",
                        file_name.to_string_lossy()
                    ),
                )));
            }
            if stat.st_nlink > 1 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to overwrite hard-linked file \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            // SAFETY: `file` is an open writable regular file descriptor.
            if unsafe { libc::ftruncate(file.as_raw_fd(), 0) } != 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            file.write_all(bytes)?;
            file.flush()?;
            Ok(())
        }

        /// Writes `bytes` to a fresh temporary file inside this directory and
        /// atomically replaces `file_name`.
        ///
        /// When replacing an existing file, write permission on the existing
        /// destination is verified without truncating it. The replacement is
        /// staged inside a private `0700` temporary directory (with inherited
        /// ACLs stripped) so no other principal can observe the temporary file
        /// while its content, ownership/group, mode bits, and extended ACLs are
        /// applied and synced before the single atomic `renameat` into place.
        /// If the original principals or ACLs cannot be preserved safely,
        /// replacement fails without modifying the destination.
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
            let c_target = os_str_to_cstring(file_name)?;

            for _ in 0..8 {
                let existing = self.open_existing_for_replace(file_name)?;
                let (stage_name, stage_dir, stage_identity, expected_new_gid) =
                    self.create_staging_dir()?;
                enum StageOutcome {
                    Published,
                    Retry,
                }

                let stage_result = if let Some(existing) = existing.as_ref() {
                    (|| -> Result<StageOutcome, ContainedFsError> {
                        let (temp_name, mut temp_file) = stage_dir.create_temp_file(0o600)?;
                        let mut temp_guard = UnixTempFileGuard::new(&stage_dir, temp_name);
                        let write_result = (|| -> io::Result<()> {
                            strip_inherited_acl(temp_file.as_raw_fd())?;
                            // SAFETY: `temp_file` is an open file descriptor.
                            if unsafe { libc::fchmod(temp_file.as_raw_fd(), 0o600) } != 0 {
                                return Err(io::Error::last_os_error());
                            }
                            temp_file.write_all(bytes)?;
                            temp_file.flush()?;
                            restore_existing_metadata(temp_file.as_raw_fd(), existing)?;
                            if durability.syncs_file() {
                                temp_file.sync_all()?;
                            }
                            Ok(())
                        })();
                        drop(temp_file);
                        write_result?;

                        // Guard against concurrent destination replacement or
                        // mode/owner/ACL/SELinux tightening while staging.
                        if !self.destination_matches_snapshot(file_name, existing)? {
                            return Ok(StageOutcome::Retry);
                        }

                        // SAFETY: both directory descriptors and C strings are valid.
                        let rc = unsafe {
                            libc::renameat(
                                stage_dir.fd.as_raw_fd(),
                                temp_guard.name.as_ptr(),
                                self.fd.as_raw_fd(),
                                c_target.as_ptr(),
                            )
                        };
                        if rc != 0 {
                            return Err(ContainedFsError::Io(io::Error::last_os_error()));
                        }
                        temp_guard.disarm();
                        Ok(StageOutcome::Published)
                    })()
                } else {
                    (|| -> Result<StageOutcome, ContainedFsError> {
                        let create_mode: libc::c_uint = match new_file_mode {
                            ContainedNewFileMode::RespectUmask => 0o666,
                            ContainedNewFileMode::Private => 0o600,
                        };
                        let (temp_name, mut temp_file) = stage_dir.create_temp_file(create_mode)?;
                        let mut temp_guard = UnixTempFileGuard::new(&stage_dir, temp_name);
                        let write_result = (|| -> io::Result<()> {
                            if let Some(expected_gid) = expected_new_gid {
                                ensure_inherited_group(temp_file.as_raw_fd(), expected_gid)?;
                            }
                            temp_file.write_all(bytes)?;
                            temp_file.flush()?;
                            if durability.syncs_file() {
                                temp_file.sync_all()?;
                            }
                            Ok(())
                        })();
                        drop(temp_file);
                        write_result?;

                        // Publish from our private staging directory without
                        // overwriting any concurrently created target, using
                        // atomic no-replace rename where supported so creation
                        // also works on filesystems without hard links (exFAT).
                        match publish_file_noreplace(
                            stage_dir.fd.as_raw_fd(),
                            &temp_guard.name,
                            self.fd.as_raw_fd(),
                            &c_target,
                        ) {
                            Ok(true) => {
                                temp_guard.disarm();
                                Ok(StageOutcome::Published)
                            }
                            Ok(false) => Ok(StageOutcome::Retry),
                            Err(error) => Err(ContainedFsError::Io(error)),
                        }
                    })()
                };

                drop(stage_dir);
                let _ = self.rmdir_stage_if_same(&stage_name, stage_identity);

                match stage_result? {
                    StageOutcome::Retry => continue,
                    StageOutcome::Published => {
                        if durability == ContainedWriteDurability::Full
                            && let Err(error) = self.sync_directory()
                        {
                            return Ok(ContainedWriteOutcome::CommittedWithoutDirSync(error));
                        }
                        return Ok(ContainedWriteOutcome::Committed);
                    }
                }
            }

            Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!(
                    "destination \"{}\" changed concurrently too many times during replacement",
                    file_name.to_string_lossy()
                ),
            )))
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

        fn create_staging_dir(
            &self,
        ) -> Result<(CString, Self, FileIdentity, Option<libc::gid_t>), ContainedFsError> {
            let mut parent_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            // SAFETY: `self.fd` is an open directory descriptor and `parent_stat` is writable.
            if unsafe { libc::fstat(self.fd.as_raw_fd(), parent_stat.as_mut_ptr()) } != 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            // SAFETY: `fstat` succeeded and initialized `parent_stat`.
            let parent_stat = unsafe { parent_stat.assume_init() };
            let expected_new_gid =
                ((parent_stat.st_mode & libc::S_ISGID) != 0).then_some(parent_stat.st_gid);
            // SAFETY: `geteuid` has no preconditions.
            let euid = unsafe { libc::geteuid() };

            let pid = std::process::id();
            for _ in 0..128 {
                let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                let mut hasher = RandomState::new().build_hasher();
                hasher.write_u32(pid);
                hasher.write_u64(nonce);
                let token = hasher.finish();
                let name = OsString::from(format!(".pmds-stage-{pid}-{nonce}-{token:016x}"));
                let c_name = os_str_to_cstring(&name)?;
                // SAFETY: `self.fd` is an open directory descriptor and `c_name` is valid.
                let rc = unsafe { libc::mkdirat(self.fd.as_raw_fd(), c_name.as_ptr(), 0o700) };
                if rc != 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::EEXIST) {
                        continue;
                    }
                    return Err(ContainedFsError::Io(error));
                }
                // SAFETY: `self.fd` is an open directory descriptor and `c_name` is valid.
                let raw = unsafe {
                    libc::openat(
                        self.fd.as_raw_fd(),
                        c_name.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                };
                if raw < 0 {
                    return Err(ContainedFsError::Io(io::Error::last_os_error()));
                }
                // SAFETY: `raw` is a newly opened valid directory descriptor.
                let fd = unsafe { OwnedFd::from_raw_fd(raw) };

                // Verify that `fd` is genuinely our newly created private empty
                // directory on the same device before mutating its ACL or mode.
                let mut stage_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                // SAFETY: `fd` is open and `stage_stat` is writable.
                if unsafe { libc::fstat(fd.as_raw_fd(), stage_stat.as_mut_ptr()) } != 0 {
                    return Err(ContainedFsError::Io(io::Error::last_os_error()));
                }
                // SAFETY: `fstat` succeeded and initialized `stage_stat`.
                let stage_stat = unsafe { stage_stat.assume_init() };
                #[allow(clippy::unnecessary_cast)]
                let identity = FileIdentity {
                    dev: stage_stat.st_dev as u64,
                    ino: stage_stat.st_ino as u64,
                };
                let is_owned_same_dir = (stage_stat.st_mode & libc::S_IFMT) == libc::S_IFDIR
                    && stage_stat.st_dev == parent_stat.st_dev
                    && stage_stat.st_uid == euid
                    && self.entry_identity(&c_name) == Some(identity);
                if !is_owned_same_dir {
                    return Err(ContainedFsError::Io(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "refusing to use unverified staging directory in shared parent",
                    )));
                }
                // Check emptiness directly via `fdopendir`/`readdir` rather than
                // `st_nlink == 2` so filesystems like Btrfs (`st_nlink == 1`) work.
                let is_empty = match is_empty_dir(fd.as_raw_fd()) {
                    Ok(empty) => empty,
                    Err(error) => {
                        drop(fd);
                        let _ = self.rmdir_stage_if_same(&c_name, identity);
                        return Err(ContainedFsError::Io(error));
                    }
                };
                if !is_empty {
                    return Err(ContainedFsError::Io(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "refusing to use non-empty staging directory in shared parent",
                    )));
                }

                let harden = (|| -> io::Result<()> {
                    strip_inherited_acl(fd.as_raw_fd())?;
                    // SAFETY: `fd` has been verified as our fresh private empty directory.
                    if unsafe { libc::fchmod(fd.as_raw_fd(), 0o700) } != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    // Verify effective mode bits after hardening so mounts that
                    // ignore `fchmod` (for example world-writable non-POSIX
                    // mounts) fail closed rather than exposing staged files.
                    let mut post_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    // SAFETY: `fd` is open and `post_stat` is writable.
                    if unsafe { libc::fstat(fd.as_raw_fd(), post_stat.as_mut_ptr()) } != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    // SAFETY: `fstat` succeeded and initialized `post_stat`.
                    let post_stat = unsafe { post_stat.assume_init() };
                    if (post_stat.st_mode & 0o0077) != 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            "staging directory cannot be made private on this filesystem",
                        ));
                    }
                    Ok(())
                })();
                if let Err(error) = harden {
                    drop(fd);
                    let _ = self.rmdir_stage_if_same(&c_name, identity);
                    return Err(ContainedFsError::Io(error));
                }
                return Ok((c_name, Self { fd }, identity, expected_new_gid));
            }
            Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "could not allocate a unique private staging directory",
            )))
        }

        fn destination_matches_snapshot(
            &self,
            file_name: &OsStr,
            expected: &ExistingTarget,
        ) -> Result<bool, ContainedFsError> {
            let Some(current) = self.open_existing_for_replace(file_name)? else {
                return Ok(false);
            };
            if current.entry != expected.entry {
                return Ok(false);
            }
            Ok(acl_equals(current.acl.as_ref(), expected.acl.as_ref())?)
        }

        fn entry_identity(&self, c_name: &CString) -> Option<FileIdentity> {
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
                return None;
            }
            // SAFETY: `fstatat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            #[allow(clippy::unnecessary_cast)]
            Some(FileIdentity {
                dev: stat.st_dev as u64,
                ino: stat.st_ino as u64,
            })
        }

        fn rmdir_stage_if_same(
            &self,
            stage_name: &CString,
            expected: FileIdentity,
        ) -> io::Result<()> {
            if self.entry_identity(stage_name) != Some(expected) {
                return Ok(());
            }
            // SAFETY: `self.fd` is an open directory descriptor and `stage_name` is valid.
            let rc = unsafe {
                libc::unlinkat(self.fd.as_raw_fd(), stage_name.as_ptr(), libc::AT_REMOVEDIR)
            };
            if rc == 0 {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
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

        fn is_symlink_entry(&self, c_name: &CString) -> bool {
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
                return false;
            }
            // SAFETY: `fstatat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            (stat.st_mode & libc::S_IFMT) == libc::S_IFLNK
        }
    }

    fn errno_location() -> Option<*mut libc::c_int> {
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "hurd",
            target_os = "l4re"
        ))]
        {
            // SAFETY: returns pointer to thread-local `errno`.
            Some(unsafe { libc::__errno_location() })
        }
        #[cfg(any(
            target_os = "macos",
            target_os = "ios",
            target_os = "tvos",
            target_os = "watchos",
            target_os = "visionos",
            target_os = "freebsd"
        ))]
        {
            // SAFETY: returns pointer to thread-local `errno`.
            Some(unsafe { libc::__error() })
        }
        #[cfg(any(
            target_os = "android",
            target_os = "netbsd",
            target_os = "openbsd",
            target_os = "cygwin"
        ))]
        {
            // SAFETY: returns pointer to thread-local `errno`.
            Some(unsafe { libc::__errno() })
        }
        #[cfg(any(target_os = "solaris", target_os = "illumos"))]
        {
            // SAFETY: returns pointer to thread-local `errno`.
            Some(unsafe { libc::___errno() })
        }
        #[cfg(not(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "hurd",
            target_os = "l4re",
            target_os = "macos",
            target_os = "ios",
            target_os = "tvos",
            target_os = "watchos",
            target_os = "visionos",
            target_os = "freebsd",
            target_os = "android",
            target_os = "netbsd",
            target_os = "openbsd",
            target_os = "cygwin",
            target_os = "solaris",
            target_os = "illumos"
        )))]
        {
            None
        }
    }

    fn is_empty_dir(fd: std::os::fd::RawFd) -> io::Result<bool> {
        let Some(errno_ptr) = errno_location() else {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "cannot verify staging directory emptiness reliably on this Unix target",
            ));
        };
        // SAFETY: `fd` is an open readable directory descriptor.
        let dup_fd = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
        if dup_fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `dup_fd` is a valid directory descriptor; `fdopendir` takes ownership on success.
        let dir = unsafe { libc::fdopendir(dup_fd) };
        if dir.is_null() {
            let error = io::Error::last_os_error();
            // SAFETY: `fdopendir` failed, so we still own `dup_fd`.
            unsafe {
                libc::close(dup_fd);
            }
            return Err(error);
        }
        let mut result = Ok(true);
        loop {
            // SAFETY: clearing thread-local `errno` before `readdir` per POSIX
            // so EOF (`errno == 0`) is distinguished from directory-read errors.
            unsafe {
                *errno_ptr = 0;
            }
            // SAFETY: `dir` is a valid `DIR*`.
            let entry = unsafe { libc::readdir(dir) };
            if entry.is_null() {
                // SAFETY: reading thread-local `errno` immediately after `readdir`.
                let err = unsafe { *errno_ptr };
                if err != 0 {
                    result = Err(io::Error::from_raw_os_error(err));
                }
                break;
            }
            // SAFETY: `entry` is non-null and `d_name` is a NUL-terminated C string.
            let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
            if name != c"." && name != c".." {
                result = Ok(false);
                break;
            }
        }
        // SAFETY: `dir` is a valid `DIR*` owned by this function.
        unsafe {
            libc::closedir(dir);
        }
        result
    }

    fn ensure_inherited_group(
        temp_fd: std::os::fd::RawFd,
        expected_gid: libc::gid_t,
    ) -> io::Result<()> {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `temp_fd` is an open file descriptor and `stat` is writable.
        if unsafe { libc::fstat(temp_fd, stat.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `fstat` succeeded and initialized `stat`.
        let stat = unsafe { stat.assume_init() };
        if stat.st_gid != expected_gid {
            // SAFETY: `temp_fd` is an open file descriptor.
            if unsafe { libc::fchown(temp_fd, libc::uid_t::MAX, expected_gid) } != 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("cannot preserve inherited directory group on new file: {error}"),
                ));
            }
        }
        Ok(())
    }

    /// Publishes `temp_name` from `stage_fd` into `target_dir_fd` as `c_target`
    /// without overwriting an existing destination.
    ///
    /// Returns `Ok(true)` when published, `Ok(false)` when `c_target` already
    /// exists (caller should retry through the existing-target replacement
    /// path), or `Err` on unexpected OS failures.
    fn publish_file_noreplace(
        stage_fd: std::os::fd::RawFd,
        temp_name: &CString,
        target_dir_fd: std::os::fd::RawFd,
        c_target: &CString,
    ) -> io::Result<bool> {
        #[cfg(target_os = "linux")]
        {
            const RENAME_NOREPLACE: libc::c_uint = 1;
            // SAFETY: both directory descriptors and C strings are valid.
            let rc = unsafe {
                libc::syscall(
                    libc::SYS_renameat2,
                    stage_fd,
                    temp_name.as_ptr(),
                    target_dir_fd,
                    c_target.as_ptr(),
                    RENAME_NOREPLACE,
                )
            };
            if rc == 0 {
                return Ok(true);
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EEXIST) {
                return Ok(false);
            }
            if !matches!(
                error.raw_os_error(),
                Some(libc::ENOSYS | libc::EINVAL | libc::EOPNOTSUPP)
            ) {
                return Err(error);
            }
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: both directory descriptors and C strings are valid.
            let rc = unsafe {
                macos_acl::renameatx_np(
                    stage_fd,
                    temp_name.as_ptr(),
                    target_dir_fd,
                    c_target.as_ptr(),
                    macos_acl::RENAME_EXCL,
                )
            };
            if rc == 0 {
                return Ok(true);
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EEXIST) {
                return Ok(false);
            }
            if !matches!(
                error.raw_os_error(),
                Some(libc::ENOTSUP | libc::EOPNOTSUPP | libc::EINVAL)
            ) {
                return Err(error);
            }
        }
        // Portable POSIX fallback when atomic no-replace rename is unavailable.
        // SAFETY: both directory descriptors and C strings are valid.
        let rc = unsafe {
            libc::linkat(
                stage_fd,
                temp_name.as_ptr(),
                target_dir_fd,
                c_target.as_ptr(),
                0,
            )
        };
        if rc != 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EEXIST) {
                return Ok(false);
            }
            return Err(error);
        }
        // SAFETY: `stage_fd` is an open directory descriptor and `temp_name` is valid.
        let _ = unsafe { libc::unlinkat(stage_fd, temp_name.as_ptr(), 0) };
        Ok(true)
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
                if matches!(error.raw_os_error(), Some(libc::ENODATA | libc::EOPNOTSUPP)) {
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
    fn remove_linux_xattr_if_present(
        fd: std::os::fd::RawFd,
        name: &std::ffi::CStr,
    ) -> io::Result<()> {
        // SAFETY: `fd` is open and `name` is a valid C string.
        if unsafe { libc::fremovexattr(fd, name.as_ptr()) } != 0 {
            let error = io::Error::last_os_error();
            if matches!(error.raw_os_error(), Some(libc::ENODATA | libc::EOPNOTSUPP)) {
                return Ok(());
            }
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("cannot clear inherited Linux ACL on replacement: {error}"),
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn strip_inherited_acl(temp_fd: std::os::fd::RawFd) -> io::Result<()> {
        remove_linux_xattr_if_present(temp_fd, c"system.posix_acl_access")?;
        remove_linux_xattr_if_present(temp_fd, c"system.posix_acl_default")?;
        remove_linux_xattr_if_present(temp_fd, c"system.nfs4_acl")?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        Ok(left == right)
    }

    #[cfg(target_os = "linux")]
    fn read_existing_acl(fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        let posix_access = read_linux_xattr(fd, c"system.posix_acl_access")?;
        let nfs4 = read_linux_xattr(fd, c"system.nfs4_acl")?;
        let selinux_label = read_linux_xattr(fd, c"security.selinux")?;
        if posix_access.is_none() && nfs4.is_none() && selinux_label.is_none() {
            Ok(None)
        } else {
            Ok(Some(ExistingAcl {
                posix_access,
                nfs4,
                selinux_label,
            }))
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
        if let Some(expected_label) = &acl.selinux_label {
            let current_label = read_linux_xattr(temp_fd, c"security.selinux")?;
            if current_label.as_deref() != Some(expected_label.as_slice()) {
                // SAFETY: `temp_fd` is open and `expected_label` is a valid buffer.
                if unsafe {
                    libc::fsetxattr(
                        temp_fd,
                        c"security.selinux".as_ptr(),
                        expected_label.as_ptr().cast::<libc::c_void>(),
                        expected_label.len(),
                        0,
                    )
                } != 0
                {
                    let error = io::Error::last_os_error();
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        format!("cannot preserve SELinux label on replacement: {error}"),
                    ));
                }
                let verified_label = read_linux_xattr(temp_fd, c"security.selinux")?;
                if verified_label.as_deref() != Some(expected_label.as_slice()) {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "cannot verify SELinux label preservation on replacement",
                    ));
                }
            }
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn serialize_macos_acl(acl: &ExistingAcl) -> io::Result<Vec<u8>> {
        // SAFETY: `acl.0` is a valid `acl_t`.
        let size = unsafe { macos_acl::acl_size(acl.0) };
        if size <= 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = vec![0u8; usize::try_from(size).unwrap_or(0)];
        // SAFETY: `buffer` has `size` writable bytes and `acl.0` is valid.
        let copied = unsafe {
            macos_acl::acl_copy_ext_native(buffer.as_mut_ptr().cast::<libc::c_void>(), acl.0, size)
        };
        if copied <= 0 {
            return Err(io::Error::last_os_error());
        }
        buffer.truncate(usize::try_from(copied).unwrap_or(0));
        Ok(buffer)
    }

    #[cfg(target_os = "macos")]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        match (left, right) {
            (None, None) => Ok(true),
            (Some(a), Some(b)) => Ok(serialize_macos_acl(a)? == serialize_macos_acl(b)?),
            _ => Ok(false),
        }
    }

    #[cfg(target_os = "macos")]
    fn strip_inherited_acl(temp_fd: std::os::fd::RawFd) -> io::Result<()> {
        // SAFETY: creating an empty extended ACL to remove any inherited ACEs.
        let empty = unsafe { macos_acl::acl_init(0) };
        if empty.is_null() {
            return Err(io::Error::last_os_error());
        }
        let empty = ExistingAcl(empty);
        // SAFETY: `temp_fd` is open and `empty.0` is a valid `acl_t`.
        if unsafe { macos_acl::acl_set_fd_np(temp_fd, empty.0, macos_acl::ACL_TYPE_EXTENDED) } != 0
        {
            let error = io::Error::last_os_error();
            if matches!(
                error.raw_os_error(),
                Some(libc::ENOENT | libc::ENOTSUP | libc::EOPNOTSUPP | libc::EINVAL)
            ) {
                return Ok(());
            }
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("cannot clear inherited macOS extended ACL on replacement: {error}"),
            ));
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

    #[cfg(target_os = "freebsd")]
    fn serialize_freebsd_acl(acl: &ExistingAcl) -> io::Result<Vec<u8>> {
        let mut len: libc::ssize_t = 0;
        // SAFETY: `acl.ptr` is a valid FreeBSD `acl_t`.
        let text = unsafe { freebsd_acl::acl_to_text_np(acl.ptr, &mut len, 0) };
        if text.is_null() {
            return Err(io::Error::last_os_error());
        }
        let bytes = if len > 0 {
            // SAFETY: `text` has `len` valid bytes allocated by `acl_to_text_np`.
            unsafe {
                std::slice::from_raw_parts(text.cast::<u8>(), usize::try_from(len).unwrap_or(0))
            }
            .to_vec()
        } else {
            Vec::new()
        };
        // SAFETY: `text` was allocated by `acl_to_text_np` and must be freed with `acl_free`.
        unsafe {
            let _ = freebsd_acl::acl_free(text.cast::<libc::c_void>());
        }
        Ok(bytes)
    }

    #[cfg(target_os = "freebsd")]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        match (left, right) {
            (None, None) => Ok(true),
            (Some(a), Some(b)) if a.acl_type == b.acl_type => {
                Ok(serialize_freebsd_acl(a)? == serialize_freebsd_acl(b)?)
            }
            _ => Ok(false),
        }
    }

    #[cfg(target_os = "freebsd")]
    fn strip_inherited_acl(temp_fd: std::os::fd::RawFd) -> io::Result<()> {
        for acl_type in [freebsd_acl::ACL_TYPE_NFS4, freebsd_acl::ACL_TYPE_ACCESS] {
            // SAFETY: `temp_fd` is an open file descriptor.
            let raw = unsafe { freebsd_acl::acl_get_fd_np(temp_fd, acl_type) };
            if raw.is_null() {
                let error = io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::EINVAL)) {
                    continue;
                }
                return Err(error);
            }
            let current = ExistingAcl { acl_type, ptr: raw };
            let mut trivial: libc::c_int = 0;
            // SAFETY: `current.ptr` is a valid FreeBSD `acl_t`.
            if unsafe { freebsd_acl::acl_is_trivial_np(current.ptr, &mut trivial) } != 0 {
                return Err(io::Error::last_os_error());
            }
            if trivial == 0 {
                // SAFETY: `current.ptr` is a valid FreeBSD `acl_t`.
                let stripped = unsafe { freebsd_acl::acl_strip_np(current.ptr, 0) };
                if stripped.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let stripped = ExistingAcl {
                    acl_type,
                    ptr: stripped,
                };
                // SAFETY: `temp_fd` is open and `stripped.ptr` is a valid FreeBSD `acl_t`.
                if unsafe { freebsd_acl::acl_set_fd_np(temp_fd, stripped.ptr, acl_type) } != 0 {
                    let error = io::Error::last_os_error();
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        format!("cannot clear inherited FreeBSD ACL on replacement: {error}"),
                    ));
                }
            }
            return Ok(());
        }
        Ok(())
    }

    #[cfg(target_os = "freebsd")]
    fn read_existing_acl(fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        for acl_type in [freebsd_acl::ACL_TYPE_NFS4, freebsd_acl::ACL_TYPE_ACCESS] {
            // SAFETY: `fd` is an open file descriptor.
            let raw = unsafe { freebsd_acl::acl_get_fd_np(fd, acl_type) };
            if raw.is_null() {
                let error = io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::EINVAL)) {
                    continue;
                }
                return Err(error);
            }
            let acl = ExistingAcl { acl_type, ptr: raw };
            let mut trivial: libc::c_int = 0;
            // SAFETY: `acl.ptr` is a valid FreeBSD `acl_t`.
            if unsafe { freebsd_acl::acl_is_trivial_np(acl.ptr, &mut trivial) } != 0 {
                return Err(io::Error::last_os_error());
            }
            return if trivial == 0 {
                Ok(Some(acl))
            } else {
                Ok(None)
            };
        }
        Ok(None)
    }

    #[cfg(target_os = "freebsd")]
    fn apply_existing_acl(temp_fd: std::os::fd::RawFd, acl: &ExistingAcl) -> io::Result<()> {
        // SAFETY: `temp_fd` is open and `acl.ptr` is a valid FreeBSD `acl_t`.
        if unsafe { freebsd_acl::acl_set_fd_np(temp_fd, acl.ptr, acl.acl_type) } != 0 {
            let error = io::Error::last_os_error();
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("cannot preserve FreeBSD ACL on replacement: {error}"),
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "openbsd")]
    fn acl_equals(_left: Option<&ExistingAcl>, _right: Option<&ExistingAcl>) -> io::Result<bool> {
        Ok(true)
    }

    #[cfg(target_os = "openbsd")]
    fn strip_inherited_acl(_temp_fd: std::os::fd::RawFd) -> io::Result<()> {
        Ok(())
    }

    #[cfg(target_os = "openbsd")]
    fn read_existing_acl(_fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        // OpenBSD does not support filesystem ACLs.
        Ok(None)
    }

    #[cfg(target_os = "openbsd")]
    fn apply_existing_acl(_temp_fd: std::os::fd::RawFd, _acl: &ExistingAcl) -> io::Result<()> {
        Ok(())
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd"
    )))]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        Ok(left.is_none() && right.is_none())
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd"
    )))]
    fn strip_inherited_acl(_temp_fd: std::os::fd::RawFd) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot verify or clear inherited filesystem ACLs on this Unix target",
        ))
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd"
    )))]
    fn read_existing_acl(_fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot verify or preserve filesystem ACLs on this Unix target",
        ))
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "freebsd",
        target_os = "openbsd"
    )))]
    fn apply_existing_acl(_temp_fd: std::os::fd::RawFd, _acl: &ExistingAcl) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot preserve filesystem ACLs on this Unix target",
        ))
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
    use std::fs::{File, OpenOptions};
    use std::io::{self, Read, Write};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
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
    const DELETE: u32 = 0x0001_0000;
    const READ_CONTROL: u32 = 0x0002_0000;
    const WRITE_DAC: u32 = 0x0004_0000;
    const WRITE_OWNER: u32 = 0x0008_0000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_ATTRIBUTE_ENCRYPTED: u32 = 0x0000_4000;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

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
    const OWNER_SECURITY_INFORMATION: u32 = 0x0000_0001;
    const DACL_SECURITY_INFORMATION: u32 = 0x0000_0004;
    const SE_DACL_PROTECTED: u16 = 0x1000;

    #[repr(C)]
    struct AclHeader {
        acl_revision: u8,
        sbz1: u8,
        acl_size: u16,
        ace_count: u16,
        sbz2: u16,
    }

    struct ExistingWindowsSecurity {
        owner_sd: Option<Vec<usize>>,
        dacl_sd: Option<Vec<usize>>,
        is_encrypted: bool,
    }

    struct WindowsTempFileGuard {
        file: File,
        armed: bool,
    }

    impl WindowsTempFileGuard {
        fn new(file: File) -> Self {
            Self { file, armed: true }
        }

        fn disarm(&mut self) {
            self.armed = false;
        }
    }

    impl Drop for WindowsTempFileGuard {
        fn drop(&mut self) {
            if self.armed {
                let _ = nt_mark_delete_on_close(self.file.as_raw_handle());
            }
        }
    }

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
        fn SetKernelObjectSecurity(
            handle: *mut c_void,
            security_information: u32,
            security_descriptor: *mut c_void,
        ) -> i32;
        fn GetSecurityDescriptorOwner(
            security_descriptor: *mut c_void,
            owner: *mut *mut c_void,
            owner_defaulted: *mut i32,
        ) -> i32;
        fn GetSecurityDescriptorControl(
            security_descriptor: *mut c_void,
            control: *mut u16,
            revision: *mut u32,
        ) -> i32;
        fn GetSecurityDescriptorDacl(
            security_descriptor: *mut c_void,
            dacl_present: *mut i32,
            dacl: *mut *mut c_void,
            dacl_defaulted: *mut i32,
        ) -> i32;
        fn EqualSid(sid1: *mut c_void, sid2: *mut c_void) -> i32;
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
        /// Uses [`OpenOptions`] so Rust's standard Windows path handling
        /// transparently supports extended-length (`> MAX_PATH`) project roots.
        ///
        /// # Errors
        ///
        /// Returns an error when `root_dir` cannot be opened as a directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            let file = OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                .open(root_dir)?;
            let handle = OwnedHandle::from(file);
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

        /// Writes `bytes` in place to `file_name` through this verified
        /// Windows directory handle without following reparse points or
        /// overwriting hard links.
        ///
        /// Writing directly to the verified handle preserves the destination's
        /// live owner, DACL, EFS encryption, and EFS recipients on update, and
        /// inherits the parent directory's native DACL and EFS settings on
        /// first creation.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// refers to a reparse point, or has multiple hard links, or
        /// [`ContainedFsError::Io`] on OS errors.
        pub fn write_file_in_place(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let handle = nt_create_relative(
                self.handle.as_raw_handle(),
                file_name,
                FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN_IF,
                FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                std::ptr::null_mut(),
            )
            .map_err(|status| ContainedFsError::Io(nt_status_to_io_error(status)))?;
            let info = file_information(handle.as_raw_handle())?;
            if (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to write through symlink \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            if info.number_of_links > 1 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to overwrite hard-linked file \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            let mut file = File::from(handle);
            file.set_len(0)?;
            file.write_all(bytes)?;
            file.flush()?;
            Ok(())
        }

        /// Atomically writes `bytes` to `file_name` inside this directory
        /// handle, verifying write access on any existing file and preserving
        /// both its DACL (at creation time) and original owner SID before
        /// syncing and renaming into place.
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
            for _ in 0..8 {
                let existing_entry = self.inspect_entry(file_name, true)?;
                let existing_identity = existing_entry.as_ref().map(|(identity, _)| *identity);
                let target_existed = existing_identity.is_some();
                let mut existing_security = existing_entry.and_then(|(_, security)| security);
                if existing_security
                    .as_ref()
                    .is_some_and(|security| security.is_encrypted)
                {
                    // Replacing an EFS-encrypted file with a newly created file
                    // cannot guarantee preservation of additional EFS
                    // recipients without EFS recipient duplication APIs; fail
                    // closed rather than silently revoking decrypt access.
                    return Err(ContainedFsError::Io(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "cannot safely preserve Windows EFS encryption recipients across atomic replacement",
                    )));
                }
                let initial_dacl = existing_security
                    .as_mut()
                    .and_then(|sec| sec.dacl_sd.as_mut())
                    .map_or(std::ptr::null_mut(), |buffer| {
                        buffer.as_mut_ptr().cast::<c_void>()
                    });

                let mut temp_guard = WindowsTempFileGuard::new(
                    self.create_temp_file(initial_dacl, existing_security.is_some())?,
                );
                temp_guard.file.write_all(bytes)?;
                temp_guard.file.flush()?;
                if let Some(existing_security) = existing_security.as_mut() {
                    if let Some(owner_sd) = existing_security.owner_sd.as_mut() {
                        restore_windows_owner(temp_guard.file.as_raw_handle(), owner_sd)?;
                    }
                    if let Some(dacl_sd) = existing_security.dacl_sd.as_mut() {
                        restore_and_verify_windows_dacl(temp_guard.file.as_raw_handle(), dacl_sd)?;
                    }
                }
                if durability.syncs_file() {
                    temp_guard.file.sync_all()?;
                }

                if let Some(expected_identity) = existing_identity {
                    let current = self.inspect_entry(file_name, true)?;
                    let Some((current_identity, mut current_security)) = current else {
                        continue;
                    };
                    if current_identity != expected_identity
                        || !windows_security_matches(
                            existing_security.as_mut(),
                            current_security.as_mut(),
                        )?
                    {
                        continue;
                    }
                }

                match nt_rename_relative(
                    temp_guard.file.as_raw_handle(),
                    self.handle.as_raw_handle(),
                    file_name,
                    target_existed,
                ) {
                    Ok(()) => {
                        temp_guard.disarm();
                        return Ok(ContainedWriteOutcome::Committed);
                    }
                    Err(STATUS_OBJECT_NAME_COLLISION) if !target_existed => {
                        continue;
                    }
                    Err(status) => {
                        return Err(ContainedFsError::Io(nt_status_to_io_error(status)));
                    }
                }
            }
            Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!(
                    "destination \"{}\" changed concurrently too many times during replacement",
                    file_name.to_string_lossy()
                ),
            )))
        }

        /// Flushes directory metadata (no-op on Windows where file sync provides durability).
        pub fn sync_directory(&self) -> io::Result<()> {
            Ok(())
        }

        fn inspect_entry(
            &self,
            file_name: &OsStr,
            for_replace: bool,
        ) -> Result<Option<(FileIdentity, Option<ExistingWindowsSecurity>)>, ContainedFsError>
        {
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
            let security = if for_replace {
                let is_encrypted = (info.file_attributes & FILE_ATTRIBUTE_ENCRYPTED) != 0;
                let owner_sd =
                    read_security_descriptor(handle.as_raw_handle(), OWNER_SECURITY_INFORMATION)?;
                let dacl_sd =
                    read_security_descriptor(handle.as_raw_handle(), DACL_SECURITY_INFORMATION)?;
                if !is_encrypted && owner_sd.is_none() && dacl_sd.is_none() {
                    None
                } else {
                    Some(ExistingWindowsSecurity {
                        owner_sd,
                        dacl_sd,
                        is_encrypted,
                    })
                }
            } else {
                None
            };
            Ok(Some((
                FileIdentity {
                    volume_serial: info.volume_serial_number,
                    file_index_high: info.file_index_high,
                    file_index_low: info.file_index_low,
                },
                security,
            )))
        }

        fn create_temp_file(
            &self,
            security_descriptor: *mut c_void,
            preserving_security: bool,
        ) -> Result<File, ContainedFsError> {
            let desired_access = if preserving_security {
                GENERIC_WRITE | READ_CONTROL | WRITE_DAC | WRITE_OWNER | DELETE | SYNCHRONIZE
            } else {
                GENERIC_WRITE | DELETE | SYNCHRONIZE
            };
            let pid = std::process::id();
            for _ in 0..128 {
                let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                let name = OsString::from(format!(".pmds-tmp-{pid}-{nonce}"));
                match nt_create_relative(
                    self.handle.as_raw_handle(),
                    &name,
                    desired_access,
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
        replace_if_exists: bool,
    ) -> Result<(), NtStatus> {
        let wide = encode_utf16_no_nul(target_name).map_err(|_| STATUS_OBJECT_PATH_NOT_FOUND)?;
        let name_bytes_len = u32::try_from(wide.len().saturating_mul(2))
            .map_err(|_| STATUS_OBJECT_PATH_NOT_FOUND)?;
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
            std::ptr::addr_of_mut!((*info).replace_if_exists).write(u8::from(replace_if_exists));
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
            return Err(status);
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

    fn read_security_descriptor(
        handle: *mut c_void,
        requested_information: u32,
    ) -> Result<Option<Vec<usize>>, ContainedFsError> {
        let mut needed: u32 = 0;
        // SAFETY: querying required buffer size with null output pointer.
        let ok = unsafe {
            GetKernelObjectSecurity(
                handle,
                requested_information,
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
                requested_information,
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

    fn restore_windows_owner(
        temp_handle: *mut c_void,
        existing_sd: &mut [usize],
    ) -> io::Result<()> {
        let mut existing_owner: *mut c_void = std::ptr::null_mut();
        let mut defaulted: i32 = 0;
        // SAFETY: `existing_sd` is a valid security descriptor returned by `GetKernelObjectSecurity`.
        if unsafe {
            GetSecurityDescriptorOwner(
                existing_sd.as_mut_ptr().cast::<c_void>(),
                &mut existing_owner,
                &mut defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if existing_owner.is_null() {
            return Ok(());
        }
        let mut temp_owner_sd = read_security_descriptor(temp_handle, OWNER_SECURITY_INFORMATION)
            .map_err(ContainedFsError::into_io_error)?;
        let owner_matches = if let Some(temp_sd) = temp_owner_sd.as_mut() {
            let mut temp_owner: *mut c_void = std::ptr::null_mut();
            let mut temp_defaulted: i32 = 0;
            // SAFETY: `temp_sd` is a valid security descriptor returned by `GetKernelObjectSecurity`.
            if unsafe {
                GetSecurityDescriptorOwner(
                    temp_sd.as_mut_ptr().cast::<c_void>(),
                    &mut temp_owner,
                    &mut temp_defaulted,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            !temp_owner.is_null() && unsafe { EqualSid(existing_owner, temp_owner) } != 0
        } else {
            false
        };
        if !owner_matches {
            // SAFETY: `temp_handle` was opened with `WRITE_OWNER` and `existing_sd` contains the owner SID.
            if unsafe {
                SetKernelObjectSecurity(
                    temp_handle,
                    OWNER_SECURITY_INFORMATION,
                    existing_sd.as_mut_ptr().cast::<c_void>(),
                )
            } == 0
            {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("cannot preserve original Windows file owner on replacement: {error}"),
                ));
            }
        }
        Ok(())
    }

    fn extract_windows_dacl(sd: &mut [usize]) -> io::Result<(bool, bool, Option<&[u8]>)> {
        let mut control: u16 = 0;
        let mut revision: u32 = 0;
        // SAFETY: `sd` is a valid security descriptor returned by `GetKernelObjectSecurity`.
        if unsafe {
            GetSecurityDescriptorControl(
                sd.as_mut_ptr().cast::<c_void>(),
                &mut control,
                &mut revision,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let mut dacl_present: i32 = 0;
        let mut dacl_ptr: *mut c_void = std::ptr::null_mut();
        let mut dacl_defaulted: i32 = 0;
        // SAFETY: `sd` is a valid security descriptor returned by `GetKernelObjectSecurity`.
        if unsafe {
            GetSecurityDescriptorDacl(
                sd.as_mut_ptr().cast::<c_void>(),
                &mut dacl_present,
                &mut dacl_ptr,
                &mut dacl_defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let protected = (control & SE_DACL_PROTECTED) != 0;
        if dacl_present == 0 {
            return Ok((protected, false, None));
        }
        if dacl_ptr.is_null() {
            return Ok((protected, true, None));
        }
        // SAFETY: `dacl_ptr` points to a valid Windows `ACL` header inside `sd`.
        let header = unsafe { &*dacl_ptr.cast::<AclHeader>() };
        let acl_size = usize::from(header.acl_size);
        // SAFETY: `acl_size` bytes starting at `dacl_ptr` belong to the valid ACL inside `sd`.
        let bytes = unsafe { std::slice::from_raw_parts(dacl_ptr.cast::<u8>(), acl_size) };
        Ok((protected, true, Some(bytes)))
    }

    fn windows_dacl_matches(
        expected_sd: &mut [usize],
        actual_sd: Option<&mut [usize]>,
    ) -> io::Result<bool> {
        let Some(actual_sd) = actual_sd else {
            return Ok(false);
        };
        let expected = extract_windows_dacl(expected_sd)?;
        let actual = extract_windows_dacl(actual_sd)?;
        Ok(expected == actual)
    }

    fn windows_owner_matches(
        expected_sd: &mut [usize],
        actual_sd: Option<&mut [usize]>,
    ) -> io::Result<bool> {
        let mut expected_owner: *mut c_void = std::ptr::null_mut();
        let mut expected_defaulted: i32 = 0;
        // SAFETY: `expected_sd` is a valid security descriptor.
        if unsafe {
            GetSecurityDescriptorOwner(
                expected_sd.as_mut_ptr().cast::<c_void>(),
                &mut expected_owner,
                &mut expected_defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let Some(actual_sd) = actual_sd else {
            return Ok(expected_owner.is_null());
        };
        let mut actual_owner: *mut c_void = std::ptr::null_mut();
        let mut actual_defaulted: i32 = 0;
        // SAFETY: `actual_sd` is a valid security descriptor.
        if unsafe {
            GetSecurityDescriptorOwner(
                actual_sd.as_mut_ptr().cast::<c_void>(),
                &mut actual_owner,
                &mut actual_defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if expected_owner.is_null() && actual_owner.is_null() {
            return Ok(true);
        }
        if expected_owner.is_null() || actual_owner.is_null() {
            return Ok(false);
        }
        // SAFETY: both SID pointers are non-null and owned by their respective descriptors.
        Ok(unsafe { EqualSid(expected_owner, actual_owner) } != 0)
    }

    fn windows_security_matches(
        expected: Option<&mut ExistingWindowsSecurity>,
        actual: Option<&mut ExistingWindowsSecurity>,
    ) -> io::Result<bool> {
        match (expected, actual) {
            (None, None) => Ok(true),
            (Some(exp), Some(act)) => {
                if exp.is_encrypted != act.is_encrypted {
                    return Ok(false);
                }
                let owners_equal = match (exp.owner_sd.as_deref_mut(), act.owner_sd.as_deref_mut())
                {
                    (None, None) => true,
                    (Some(exp_owner), act_owner) => windows_owner_matches(exp_owner, act_owner)?,
                    (None, Some(_)) => false,
                };
                if !owners_equal {
                    return Ok(false);
                }
                match (exp.dacl_sd.as_deref_mut(), act.dacl_sd.as_deref_mut()) {
                    (None, None) => Ok(true),
                    (Some(exp_dacl), act_dacl) => windows_dacl_matches(exp_dacl, act_dacl),
                    (None, Some(_)) => Ok(false),
                }
            }
            _ => Ok(false),
        }
    }

    fn restore_and_verify_windows_dacl(
        temp_handle: *mut c_void,
        existing_dacl_sd: &mut [usize],
    ) -> io::Result<()> {
        let mut current_dacl_sd = read_security_descriptor(temp_handle, DACL_SECURITY_INFORMATION)
            .map_err(ContainedFsError::into_io_error)?;
        if windows_dacl_matches(existing_dacl_sd, current_dacl_sd.as_deref_mut())? {
            return Ok(());
        }
        // Apply the original DACL directly via `SetKernelObjectSecurity` (which
        // does not run Win32 parent auto-inheritance) and re-verify the
        // effective DACL before publishing the replacement.
        // SAFETY: `temp_handle` was opened with `WRITE_DAC` and `existing_dacl_sd` is valid.
        if unsafe {
            SetKernelObjectSecurity(
                temp_handle,
                DACL_SECURITY_INFORMATION,
                existing_dacl_sd.as_mut_ptr().cast::<c_void>(),
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("cannot preserve original Windows DACL on replacement: {error}"),
            ));
        }
        let mut verified_dacl_sd = read_security_descriptor(temp_handle, DACL_SECURITY_INFORMATION)
            .map_err(ContainedFsError::into_io_error)?;
        if !windows_dacl_matches(existing_dacl_sd, verified_dacl_sd.as_deref_mut())? {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "cannot verify exact Windows DACL preservation on replacement",
            ));
        }
        Ok(())
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

        /// Writes `bytes` in place to `file_name` after verifying containment.
        pub fn write_file_in_place(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> Result<(), ContainedFsError> {
            self.reject_symlink(file_name)?;
            fs::write(self.dir.join(file_name), bytes)?;
            Ok(())
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
    fn read_macos_acl_native_bytes(path: &Path) -> Option<Vec<u8>> {
        use std::os::fd::AsRawFd;

        const ACL_TYPE_EXTENDED: libc::c_int = 0x0000_0100;
        const ACL_FIRST_ENTRY: libc::c_int = 0;

        unsafe extern "C" {
            fn acl_get_fd_np(fd: libc::c_int, type_: libc::c_int) -> *mut libc::c_void;
            fn acl_get_entry(
                acl: *mut libc::c_void,
                entry_id: libc::c_int,
                entry_p: *mut *mut libc::c_void,
            ) -> libc::c_int;
            fn acl_size(acl: *mut libc::c_void) -> libc::ssize_t;
            fn acl_copy_ext_native(
                buf_p: *mut libc::c_void,
                acl: *mut libc::c_void,
                size: libc::ssize_t,
            ) -> libc::ssize_t;
            fn acl_free(obj_p: *mut libc::c_void) -> libc::c_int;
        }

        let file = fs::File::open(path).expect("open file for ACL inspection");
        // SAFETY: `file` is open.
        let acl = unsafe { acl_get_fd_np(file.as_raw_fd(), ACL_TYPE_EXTENDED) };
        if acl.is_null() {
            return None;
        }
        let mut entry: *mut libc::c_void = std::ptr::null_mut();
        // SAFETY: `acl` is a valid `acl_t`.
        let has_entry = unsafe { acl_get_entry(acl, ACL_FIRST_ENTRY, &mut entry) } == 0;
        let result = if has_entry {
            // SAFETY: `acl` is a valid `acl_t`.
            let size = unsafe { acl_size(acl) };
            assert!(size > 0, "expected positive serialized ACL size");
            let mut buffer = vec![0u8; usize::try_from(size).expect("non-negative ACL size")];
            // SAFETY: `buffer` has `size` writable bytes and `acl` is valid.
            let copied = unsafe {
                acl_copy_ext_native(buffer.as_mut_ptr().cast::<libc::c_void>(), acl, size)
            };
            assert!(copied > 0, "expected acl_copy_ext_native to succeed");
            buffer.truncate(usize::try_from(copied).expect("non-negative copied size"));
            Some(buffer)
        } else {
            None
        };
        // SAFETY: `acl` was returned by `acl_get_fd_np`.
        unsafe {
            let _ = acl_free(acl);
        }
        result
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
        let before = read_macos_acl_native_bytes(&target).expect("seeded ACL must be present");

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        dir.write_file_atomically(
            OsStr::new("en.mjs"),
            b"after",
            ContainedNewFileMode::RespectUmask,
            ContainedWriteDurability::Rename,
        )
        .expect("atomic replacement with ACL succeeds");
        assert_eq!(fs::read_to_string(&target).expect("read replaced"), "after");

        let after = read_macos_acl_native_bytes(&target).expect("ACL must survive replacement");
        assert_eq!(
            after, before,
            "replaced file must retain exact serialized macOS ACL independent of name resolution"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn clears_inherited_macos_acl_when_replacing_file_without_acl() {
        use std::process::Command;

        let root = tempfile::tempdir().expect("temp dir");
        let status = Command::new("/bin/chmod")
            .args(["+a", "everyone allow read,file_inherit"])
            .arg(root.path())
            .status()
            .expect("invoke /bin/chmod +a on dir");
        if !status.success() {
            return;
        }

        // Verify directory ACL inheritance is active before testing removal.
        let probe = root.path().join("probe.mjs");
        fs::write(&probe, "probe").expect("seed probe");
        assert!(
            read_macos_acl_native_bytes(&probe).is_some(),
            "expected directory file_inherit ACL to attach to newly created probe file"
        );

        let target = root.path().join("en.mjs");
        fs::write(&target, "before").expect("seed file");
        let clear = Command::new("/bin/chmod")
            .args(["-N"])
            .arg(&target)
            .status()
            .expect("invoke /bin/chmod -N on target");
        assert!(clear.success(), "chmod -N must strip inherited ACL");
        assert!(
            read_macos_acl_native_bytes(&target).is_none(),
            "target must have no ACL before replacement"
        );

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        dir.write_file_atomically(
            OsStr::new("en.mjs"),
            b"after",
            ContainedNewFileMode::RespectUmask,
            ContainedWriteDurability::Rename,
        )
        .expect("atomic replacement clears inherited ACL");
        assert_eq!(fs::read_to_string(&target).expect("read replaced"), "after");
        assert!(
            read_macos_acl_native_bytes(&target).is_none(),
            "inherited ACL must not survive when original file had no ACL"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn preserves_directory_file_inherit_acl_on_first_creation() {
        use std::process::Command;

        let root = tempfile::tempdir().expect("temp dir");
        let status = Command::new("/bin/chmod")
            .args(["+a", "everyone allow read,file_inherit"])
            .arg(root.path())
            .status()
            .expect("invoke /bin/chmod +a on dir");
        if !status.success() {
            return;
        }

        let baseline = root.path().join("baseline.mjs");
        fs::write(&baseline, "baseline").expect("seed baseline file");
        let expected_acl =
            read_macos_acl_native_bytes(&baseline).expect("baseline file must inherit ACL");

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        dir.write_file_in_place(OsStr::new("fresh.mjs"), b"fresh")
            .expect("initial in-place creation succeeds");
        let fresh = root.path().join("fresh.mjs");
        assert_eq!(fs::read_to_string(&fresh).expect("read fresh"), "fresh");
        let actual_acl = read_macos_acl_native_bytes(&fresh)
            .expect("newly created file must preserve destination directory file_inherit ACL");
        assert_eq!(actual_acl, expected_acl);
    }
}
