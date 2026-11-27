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

/// Filename equivalence policy detected for a directory's filesystem.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirFilenameEquivalence {
    /// Exact byte-for-byte comparison (standard Linux ext4/xfs/btrfs/tmpfs or
    /// Windows NTFS with per-directory case sensitivity enabled).
    Exact,
    /// Case-sensitive, Unicode NFD normalization-insensitive (APFS Case-Sensitive).
    UnicodeNfd,
    /// Case-sensitive HFS+: Unicode NFD with HFS+ decomposition exclusions
    /// (`U+2000..=U+2FFF`, `U+F900..=U+FAFF`, `U+2F800..=U+2FA1F` stay distinct).
    UnicodeHfsPlus,
    /// Case-insensitive 1-to-1 uppercase without Unicode normalization
    /// (Windows NTFS, FAT/exFAT, SMB/CIFS).
    CaseInsensitiveNtfs,
    /// Case-insensitive full Unicode casefold + NFD preserving default-ignorable
    /// code points (default macOS/iOS APFS).
    CaseInsensitiveUnicodeNfd,
    /// Case-insensitive HFS+: HFS+ NFD (with TN1150 decomposition exclusions) +
    /// 1-to-1 BMP code-unit lowercase fold + HFS+ ignorable stripping
    /// (`straße` != `strasse`, `U+F900` != `U+8C48`, `café` == `cafe\u{0301}`).
    CaseInsensitiveHfsPlus,
    /// Linux `FS_CASEFOLD_FL` NFDICF: full Unicode casefold + NFD with
    /// `Default_Ignorable_Code_Point` removal (ext4/f2fs/tmpfs casefold).
    CaseInsensitiveUnicodeNfdicf,
}

fn normalize_anchor_root(root_dir: &Path) -> &Path {
    if root_dir.as_os_str().is_empty() {
        Path::new(".")
    } else {
        root_dir
    }
}

/// Signature written into `.pmds-lock` before publication so both Unix and
/// Windows writers distinguish Palamedes lock files from unrelated user files.
#[cfg(any(unix, windows))]
const DIR_LOCK_MAGIC: &[u8] = b"palamedes-dir-lock-v1\n";

pub(crate) fn is_reserved_lock_segment(text: &str) -> bool {
    let mut normalized = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(
            ch,
            '\u{00ad}'
                | '\u{034f}'
                | '\u{061c}'
                | '\u{115f}'..='\u{1160}'
                | '\u{17b4}'..='\u{17b5}'
                | '\u{180b}'..='\u{180f}'
                | '\u{200b}'..='\u{200f}'
                | '\u{202a}'..='\u{202e}'
                | '\u{2060}'..='\u{206f}'
                | '\u{3164}'
                | '\u{fe00}'..='\u{fe0f}'
                | '\u{feff}'
                | '\u{ffa0}'
                | '\u{fff0}'..='\u{fff8}'
                | '\u{1bca0}'..='\u{1bca3}'
                | '\u{1d173}'..='\u{1d17a}'
                | '\u{e0000}'..='\u{e0fff}'
        ) {
            continue;
        }
        match ch {
            '\u{017f}' => normalized.push('s'),
            '\u{212a}' => normalized.push('k'),
            other => normalized.push(other.to_ascii_lowercase()),
        }
    }
    normalized.trim_end_matches(['.', ' ']) == ".pmds-lock"
}

fn is_reserved_lock_file_name(file_name: &OsStr) -> bool {
    file_name.to_str().is_some_and(is_reserved_lock_segment)
}

fn validate_writable_file_name(file_name: &OsStr) -> Result<(), ContainedFsError> {
    validate_single_file_name(file_name)?;
    if is_reserved_lock_file_name(file_name) {
        return Err(ContainedFsError::Containment(format!(
            "refusing to write reserved catalog lock filename \"{}\"",
            file_name.to_string_lossy()
        )));
    }
    Ok(())
}

fn validate_dir_segment(segment: &OsStr) -> Result<(), ContainedFsError> {
    validate_single_file_name(segment)?;
    if is_reserved_lock_file_name(segment) {
        return Err(ContainedFsError::Containment(format!(
            "refusing to use reserved catalog lock directory name \"{}\"",
            segment.to_string_lossy()
        )));
    }
    Ok(())
}

/// Stable on-disk file identity used to detect hard-linked input/output aliases.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FileIdentity {
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(windows)]
    volume_serial: u64,
    #[cfg(windows)]
    file_id: [u8; 16],
    #[cfg(not(any(unix, windows)))]
    _unsupported: (),
}

/// Canonical filesystem-identity key used to deduplicate and order
/// cross-process catalog locks independently of path spelling or case.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TargetLockKey {
    #[cfg(windows)]
    dir_id: Option<FileIdentity>,
    #[cfg(not(windows))]
    dir_id: FileIdentity,
    target_hash: u64,
}

impl FileIdentity {
    /// Returns whether two identities reside on the same filesystem volume.
    #[must_use]
    pub const fn same_volume(self, other: Self) -> bool {
        #[cfg(unix)]
        {
            self.dev == other.dev
        }
        #[cfg(windows)]
        {
            self.volume_serial == other.volume_serial
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = (self, other);
            true
        }
    }
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
    if matches!(components.next(), Some(Component::Normal(part)) if part == file_name)
        && components.next().is_none()
    {
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
            Component::Normal(part) => {
                validate_dir_segment(part)?;
                segments.push(part.to_os_string());
            }
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
    use std::cell::RefCell;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    use std::collections::HashSet;
    use std::collections::{HashMap, hash_map::RandomState};
    use std::ffi::{CString, OsStr, OsString};
    use std::fs::File;
    use std::hash::{BuildHasher, Hasher};
    use std::io::{self, Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;
    use std::rc::{Rc, Weak};
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, ContainedWriteOutcome,
        DirFilenameEquivalence, FileIdentity, TargetLockKey, validate_dir_segment,
        validate_relative_dir_segments, validate_single_file_name,
    };

    pub(super) const UNIX_DIR_LOCK_NAME: &std::ffi::CStr = c".pmds-lock";
    pub(super) const UNIX_DIR_LOCK_MAGIC: &[u8] = super::DIR_LOCK_MAGIC;

    #[derive(Debug)]
    struct UnixDirLock {
        key: FileIdentity,
        cleanup: Option<(OwnedFd, CString, FileIdentity)>,
        _fd: OwnedFd,
        _secondary_fd: Option<OwnedFd>,
    }

    impl Drop for UnixDirLock {
        fn drop(&mut self) {
            // Unlink the owned lock/claim entry while `self._fd` still holds
            // `flock(LOCK_EX)` (and `_secondary_fd`, when present, still holds
            // `LOCK_SH` on the foreign `.pmds-lock`) so waiters that wake on
            // unlock observe the unlink atomically and re-verify against the
            // directory entry.
            if let Some((ref dir_fd, ref entry_name, expected_id)) = self.cleanup
                && let Ok(stat) = fstatat_nofollow(dir_fd.as_raw_fd(), entry_name)
                && stat_identity(&stat) == expected_id
            {
                // SAFETY: `dir_fd` is open and `entry_name` is a valid C string.
                unsafe {
                    let _ = libc::unlinkat(dir_fd.as_raw_fd(), entry_name.as_ptr(), 0);
                }
            }
            HELD_UNIX_DIR_LOCKS.with(|held| {
                let mut map = held.borrow_mut();
                if map
                    .get(&self.key)
                    .is_some_and(|weak| weak.strong_count() == 0)
                {
                    map.remove(&self.key);
                }
            });
        }
    }

    thread_local! {
        static HELD_UNIX_DIR_LOCKS: RefCell<HashMap<FileIdentity, Weak<UnixDirLock>>> =
            RefCell::new(HashMap::new());
    }

    /// Exclusive cross-process and cross-thread guard serializing catalog
    /// read-modify-write operations targeting a [`ContainedDir`].
    ///
    /// Deliberately `!Send` and `!Sync` (via [`Rc`]) so the OS lock is always
    /// released on the acquiring thread when the last reentrant guard drops.
    #[derive(Debug)]
    pub struct ContainedTargetLock {
        _lock: Rc<UnixDirLock>,
    }

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
        #[cfg(any(
            target_os = "macos",
            target_os = "ios",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        flags: u32,
        identity: FileIdentity,
    }

    struct ExistingTarget {
        entry: ExistingEntry,
        acl: Option<ExistingAcl>,
        xattrs: Vec<(CString, Vec<u8>)>,
        #[cfg(target_os = "linux")]
        linux_flags: Option<libc::c_int>,
        #[cfg(target_os = "linux")]
        linux_fsxattr: Option<super::LinuxFsxattrSnapshot>,
    }

    enum SnapshotMatch {
        Unchanged,
        MetadataChanged,
        Replaced,
    }

    #[cfg(target_os = "linux")]
    #[derive(PartialEq, Eq)]
    struct ExistingAcl {
        posix_access: Option<Vec<u8>>,
        nfs4: Option<Vec<u8>>,
        security_xattrs: Vec<(CString, Vec<u8>)>,
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    struct ExistingAcl(*mut libc::c_void);

    #[cfg(any(target_os = "macos", target_os = "ios"))]
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

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd"
    )))]
    struct ExistingAcl;

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    mod macos_acl {
        pub(super) const ACL_TYPE_EXTENDED: libc::c_int = 0x0000_0100;
        pub(super) const ACL_FIRST_ENTRY: libc::c_int = 0;
        pub(super) const ACL_NEXT_ENTRY: libc::c_int = -1;
        pub(super) const ACL_ENTRY_INHERITED: libc::c_int = 1 << 4;
        pub(super) const ACL_ENTRY_FILE_INHERIT: libc::c_int = 1 << 5;
        pub(super) const ACL_ENTRY_DIRECTORY_INHERIT: libc::c_int = 1 << 6;
        pub(super) const ACL_ENTRY_LIMIT_INHERIT: libc::c_int = 1 << 7;
        pub(super) const ACL_ENTRY_ONLY_INHERIT: libc::c_int = 1 << 8;
        pub(super) const ACL_EXTENDED_ALLOW: libc::c_int = 1;
        pub(super) const ACL_ADD_FILE: libc::c_int = 1 << 2;
        pub(super) const ACL_DELETE: libc::c_int = 1 << 4;
        pub(super) const ACL_ADD_SUBDIRECTORY: libc::c_int = 1 << 5;
        pub(super) const ACL_DELETE_CHILD: libc::c_int = 1 << 6;
        pub(super) const ACL_WRITE_ATTRIBUTES: libc::c_int = 1 << 8;
        pub(super) const ACL_WRITE_EXTATTRIBUTES: libc::c_int = 1 << 10;
        pub(super) const ACL_WRITE_SECURITY: libc::c_int = 1 << 12;
        pub(super) const ACL_CHANGE_OWNER: libc::c_int = 1 << 13;
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
            pub(super) fn acl_get_tag_type(
                entry_d: *mut libc::c_void,
                tag_type_p: *mut libc::c_int,
            ) -> libc::c_int;
            pub(super) fn acl_get_qualifier(entry_d: *mut libc::c_void) -> *mut libc::c_void;
            pub(super) fn mbr_uid_to_uuid(id: libc::uid_t, uu: *mut u8) -> libc::c_int;
            pub(super) fn acl_get_permset(
                entry_d: *mut libc::c_void,
                permset_p: *mut *mut libc::c_void,
            ) -> libc::c_int;
            pub(super) fn acl_get_perm_np(
                permset_d: *mut libc::c_void,
                perm: libc::c_int,
            ) -> libc::c_int;
            pub(super) fn acl_create_entry(
                acl_p: *mut *mut libc::c_void,
                entry_p: *mut *mut libc::c_void,
            ) -> libc::c_int;
            pub(super) fn acl_copy_entry(
                dest_d: *mut libc::c_void,
                src_d: *mut libc::c_void,
            ) -> libc::c_int;
            pub(super) fn acl_get_flagset_np(
                obj_p: *mut libc::c_void,
                flagset_p: *mut *mut libc::c_void,
            ) -> libc::c_int;
            pub(super) fn acl_get_flag_np(
                flagset_d: *mut libc::c_void,
                flag: libc::c_int,
            ) -> libc::c_int;
            pub(super) fn acl_add_flag_np(
                flagset_d: *mut libc::c_void,
                flag: libc::c_int,
            ) -> libc::c_int;
            pub(super) fn acl_delete_flag_np(
                flagset_d: *mut libc::c_void,
                flag: libc::c_int,
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
        pub(super) const ACL_FIRST_ENTRY: libc::c_int = 0;
        pub(super) const ACL_NEXT_ENTRY: libc::c_int = 1;
        pub(super) const ACL_ENTRY_FILE_INHERIT: u16 = 0x0001;

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
            pub(super) fn acl_get_entry(
                acl: *mut libc::c_void,
                entry_id: libc::c_int,
                entry_p: *mut *mut libc::c_void,
            ) -> libc::c_int;
            pub(super) fn acl_get_flagset_np(
                entry_d: *mut libc::c_void,
                flagset_p: *mut *mut libc::c_void,
            ) -> libc::c_int;
            pub(super) fn acl_get_flag_np(flagset_d: *mut libc::c_void, flag: u16) -> libc::c_int;
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
            let root_dir = super::normalize_anchor_root(root_dir);
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
                    // Use `0755` rather than `0777` so a common `0002` umask
                    // does not create a group-writable directory that later
                    // fails `parent_allows_safe_staging`.
                    // SAFETY: `current.fd` is an open directory descriptor and `c_segment` is valid.
                    let rc =
                        unsafe { libc::mkdirat(current.fd.as_raw_fd(), c_segment.as_ptr(), 0o755) };
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

        /// Opens a direct existing child directory named `segment` without
        /// following symlinks.
        ///
        /// Returns `Ok(None)` when `segment` does not exist.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `segment` is invalid or
        /// refers to a symlink, or [`ContainedFsError::Io`] on OS errors.
        pub fn open_existing_child_dir(
            &self,
            segment: &OsStr,
        ) -> Result<Option<Self>, ContainedFsError> {
            validate_dir_segment(segment)?;
            let c_segment = os_str_to_cstring(segment)?;
            // SAFETY: `self.fd` is an open directory descriptor and `c_segment` is valid.
            let next = unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    c_segment.as_ptr(),
                    DIR_TRAVERSAL_FLAGS | libc::O_NOFOLLOW,
                )
            };
            if next < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ENOENT) {
                    return Ok(None);
                }
                if is_symlink_open_error(error.raw_os_error())
                    || (error.raw_os_error() == Some(libc::ENOTDIR)
                        && self.is_symlink_entry(&c_segment))
                {
                    return Err(ContainedFsError::Containment(format!(
                        "refusing to follow symlink at directory component \"{}\"",
                        segment.to_string_lossy()
                    )));
                }
                return Err(ContainedFsError::Io(error));
            }
            // SAFETY: `next` is a newly opened valid file descriptor.
            Ok(Some(Self {
                fd: unsafe { OwnedFd::from_raw_fd(next) },
            }))
        }

        /// Returns the on-disk identity of this directory itself.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Io`] if `fstat` fails.
        pub fn self_identity(&self) -> Result<Option<FileIdentity>, ContainedFsError> {
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            // SAFETY: `self.fd` is open and `stat` is writable.
            if unsafe { libc::fstat(self.fd.as_raw_fd(), stat.as_mut_ptr()) } != 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            // SAFETY: `fstat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            #[allow(clippy::unnecessary_cast)]
            Ok(Some(FileIdentity {
                dev: stat.st_dev as u64,
                ino: stat.st_ino as u64,
            }))
        }

        /// Detects the filename equivalence policy of this directory's
        /// filesystem without mutating the filesystem.
        #[must_use]
        pub fn filename_equivalence(&self) -> Option<DirFilenameEquivalence> {
            detect_unix_dir_filename_equivalence(self)
        }

        /// Read-only filename equivalence check that inspects only already-existing
        /// entries in `self` without mutating the directory.
        #[must_use]
        pub fn probe_existing_names_equivalent(&self, left: &OsStr, right: &OsStr) -> Option<bool> {
            if left == right {
                return Some(true);
            }
            if validate_single_file_name(left).is_err() || validate_single_file_name(right).is_err()
            {
                return None;
            }
            match (self.file_identity(left), self.file_identity(right)) {
                (Ok(Some(left_id)), Ok(Some(right_id))) => Some(left_id == right_id),
                (Ok(Some(_)), Ok(None)) | (Ok(None), Ok(Some(_))) => Some(false),
                _ => None,
            }
        }

        /// Probes whether two single-segment filenames resolve to the same
        /// entry on this directory's mounted filesystem by checking existing
        /// entries first and, when neither exists, creating a verified private
        /// `0700` temporary subdirectory inside `self` (using the same
        /// safe-parent and identity checks as `create_staging_dir`, inheriting
        /// volume encoding and Linux `FS_CASEFOLD_FL`) and testing
        /// `O_CREAT | O_EXCL` for `left` then `right`.
        ///
        /// Returns `Some(true)` when the filesystem treats both names as
        /// equivalent, `Some(false)` when both coexist as distinct files, or
        /// `None` when the directory is read-only, unsafe to stage in, or
        /// cannot be probed safely.
        #[must_use]
        pub fn probe_names_equivalent(&self, left: &OsStr, right: &OsStr) -> Option<bool> {
            if let Some(result) = self.probe_existing_names_equivalent(left, right) {
                return Some(result);
            }
            if validate_single_file_name(left).is_err() || validate_single_file_name(right).is_err()
            {
                return None;
            }
            let c_left = CString::new(left.as_bytes()).ok()?;
            let c_right = CString::new(right.as_bytes()).ok()?;
            let (c_probe_name, probe_dir, probe_identity) = self.create_staging_dir(false).ok()?;
            struct ProbeDirCleanup<'a> {
                parent: &'a ContainedDir,
                name: CString,
                dir: Option<ContainedDir>,
                identity: FileIdentity,
            }
            impl Drop for ProbeDirCleanup<'_> {
                fn drop(&mut self) {
                    self.dir.take();
                    let _ = self.parent.rmdir_stage_if_same(&self.name, self.identity);
                }
            }
            let cleanup = ProbeDirCleanup {
                parent: self,
                name: c_probe_name,
                dir: Some(probe_dir),
                identity: probe_identity,
            };
            let probe_dir_raw = cleanup.dir.as_ref()?.fd.as_raw_fd();

            // SAFETY: `probe_dir_raw` is open and `c_left` is a validated single segment.
            let left_raw = unsafe {
                libc::openat(
                    probe_dir_raw,
                    c_left.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600 as libc::c_uint,
                )
            };
            if left_raw < 0 {
                return None;
            }
            // SAFETY: `left_raw` is a newly opened valid file descriptor.
            drop(unsafe { OwnedFd::from_raw_fd(left_raw) });

            // SAFETY: `probe_dir_raw` is open and `c_right` is a validated single segment.
            let right_raw = unsafe {
                libc::openat(
                    probe_dir_raw,
                    c_right.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600 as libc::c_uint,
                )
            };
            let result = if right_raw >= 0 {
                // SAFETY: `right_raw` is a newly opened valid file descriptor.
                drop(unsafe { OwnedFd::from_raw_fd(right_raw) });
                // SAFETY: `probe_dir_raw` is open and `c_right` was just created.
                unsafe {
                    let _ = libc::unlinkat(probe_dir_raw, c_right.as_ptr(), 0);
                }
                Some(false)
            } else if io::Error::last_os_error().raw_os_error() == Some(libc::EEXIST) {
                Some(true)
            } else {
                None
            };
            // SAFETY: `probe_dir_raw` is open and `c_left` was just created.
            unsafe {
                let _ = libc::unlinkat(probe_dir_raw, c_left.as_ptr(), 0);
            }
            drop(cleanup);
            result
        }

        /// Detects whether filenames in this specific directory are compared
        /// case-insensitively without mutating the filesystem.
        ///
        /// Returns `None` when case sensitivity cannot be determined directly
        /// (for example, an empty directory on an unrecognized mount).
        #[must_use]
        pub fn is_case_insensitive(&self) -> Option<bool> {
            self.filename_equivalence().map(|eq| {
                matches!(
                    eq,
                    DirFilenameEquivalence::CaseInsensitiveNtfs
                        | DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
                        | DirFilenameEquivalence::CaseInsensitiveHfsPlus
                        | DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf
                )
            })
        }

        /// Detects whether canonically equivalent Unicode filenames (NFC vs
        /// NFD) resolve to the same entry in this directory.
        #[must_use]
        pub fn is_unicode_normalizing(&self) -> Option<bool> {
            self.filename_equivalence().map(|eq| {
                matches!(
                    eq,
                    DirFilenameEquivalence::UnicodeNfd
                        | DirFilenameEquivalence::UnicodeHfsPlus
                        | DirFilenameEquivalence::CaseInsensitiveUnicodeNfd
                        | DirFilenameEquivalence::CaseInsensitiveHfsPlus
                        | DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf
                )
            })
        }

        /// Returns the canonical filesystem-identity lock key for `file_name`
        /// in this directory, used to deduplicate and order multi-target locks.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// or [`ContainedFsError::Io`] if directory identity lookup fails.
        pub fn target_lock_key(
            &self,
            file_name: &OsStr,
        ) -> Result<TargetLockKey, ContainedFsError> {
            validate_single_file_name(file_name)?;
            let dir_id = self.self_identity()?.ok_or_else(|| {
                ContainedFsError::Io(io::Error::other("missing Unix directory identity"))
            })?;
            Ok(TargetLockKey {
                dir_id,
                target_hash: 0,
            })
        }

        /// Acquires an exclusive cross-process and cross-thread lock covering
        /// read-modify-write operations on `file_name` in this directory.
        ///
        /// Uses a handle-relative regular lock file (`.pmds-lock`) opened
        /// read-write so exclusive `flock` works on Linux NFS remote locks and
        /// write+search-only (`0311`) directories without listing permission,
        /// while refusing to overwrite or delete pre-existing non-lock files.
        /// Re-entrant on the same thread; the underlying OS lock stays held
        /// until the last live guard for this directory drops.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid
        /// or `.pmds-lock` is a symlink/hard-link/non-regular file, or
        /// [`ContainedFsError::Io`] on OS lock failures or pre-existing
        /// non-lock collisions.
        pub fn lock_target(
            &self,
            file_name: &OsStr,
        ) -> Result<ContainedTargetLock, ContainedFsError> {
            let key = self.target_lock_key(file_name)?.dir_id;
            if let Some(existing) =
                HELD_UNIX_DIR_LOCKS.with(|held| held.borrow().get(&key).and_then(Weak::upgrade))
            {
                return Ok(ContainedTargetLock { _lock: existing });
            }

            let lock = Rc::new(acquire_unix_dir_lock(self, key)?);
            HELD_UNIX_DIR_LOCKS.with(|held| {
                held.borrow_mut().insert(key, Rc::downgrade(&lock));
            });
            Ok(ContainedTargetLock { _lock: lock })
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

        /// Rejects `file_name` if it already exists as a symlink or a
        /// multi-link hard link (`st_nlink > 1`).
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// refers to a symlink, or has multiple hard links.
        pub fn reject_symlink_or_hard_link(
            &self,
            file_name: &OsStr,
        ) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
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
                    return Ok(());
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
            if stat.st_nlink > 1 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to overwrite hard-linked file \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            Ok(())
        }

        /// Returns the on-disk identity of `file_name` inside this directory, or
        /// `None` if it does not exist.
        ///
        /// Returns `true` if `file_name` exists in this directory (and is not a
        /// symlink), or `false` if it does not exist.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid
        /// or a symlink, or [`ContainedFsError::Io`] on OS errors.
        pub fn entry_exists(&self, file_name: &OsStr) -> Result<bool, ContainedFsError> {
            validate_single_file_name(file_name)?;
            Ok(self.inspect_entry(file_name)?.is_some())
        }

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

        /// Reads `file_name` directly from this directory without following
        /// symlinks or blocking on non-regular files (such as FIFOs).
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is a
        /// symlink or non-regular file, or [`ContainedFsError::Io`] on OS read
        /// failures.
        pub fn read_optional_file(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<String>, ContainedFsError> {
            validate_single_file_name(file_name)?;
            let c_name = os_str_to_cstring(file_name)?;
            // Open with `O_NONBLOCK` so a FIFO planted at `file_name` returns
            // immediately instead of blocking while holding a directory lock.
            // SAFETY: `self.fd` is an open directory descriptor and `c_name` is valid.
            let raw = unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    c_name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
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
            let fd = unsafe { OwnedFd::from_raw_fd(raw) };
            let stat = fstat_fd(fd.as_raw_fd())?;
            match stat.st_mode & libc::S_IFMT {
                libc::S_IFREG => {}
                libc::S_IFDIR => {
                    return Err(ContainedFsError::Io(io::Error::from_raw_os_error(
                        libc::EISDIR,
                    )));
                }
                _ => {
                    return Err(ContainedFsError::Containment(format!(
                        "refusing to read non-regular file \"{}\"",
                        file_name.to_string_lossy()
                    )));
                }
            }
            let mut file = File::from(fd);
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            Ok(Some(content))
        }

        /// Writes `bytes` to `file_name` through this verified directory
        /// handle without following symlinks or overwriting hard-linked files.
        ///
        /// When `file_name` already exists as a single-link regular file
        /// (`st_nlink == 1`), updates the existing inode in place under the
        /// directory target lock after verifying its handle identity against
        /// `fstatat(AT_SYMLINK_NOFOLLOW)` and stripping `S_ISUID | S_ISGID`.
        /// Updating the existing inode preserves all inode-bound and
        /// kernel-hidden metadata (including Linux `trusted.*` xattrs that
        /// `flistxattr` hides from callers without `CAP_SYS_ADMIN`, IMA/EVM
        /// metadata, and unreadable macOS/BSD attributes), matching
        /// `std::fs::write` semantics without following symlinks or mutating
        /// hard links.
        ///
        /// When `file_name` does not exist yet, creates it atomically via
        /// [`Self::write_file_atomically`] with
        /// [`ContainedNewFileMode::RespectUmask`] so umask and directory ACL
        /// inheritance are respected without following symlinks.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// reserved, refers to a symlink, or has multiple hard links, or
        /// [`ContainedFsError::Io`] on OS errors.
        pub fn write_file_in_place(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> Result<(), ContainedFsError> {
            super::validate_writable_file_name(file_name)?;
            let _target_lock = self.lock_target(file_name)?;
            let c_target = os_str_to_cstring(file_name)?;

            for _ in 0..8 {
                // SAFETY: `self.fd` is an open directory descriptor and `c_target` is valid.
                let raw = unsafe {
                    libc::openat(
                        self.fd.as_raw_fd(),
                        c_target.as_ptr(),
                        libc::O_WRONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
                    )
                };
                if raw < 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::ENOENT) {
                        match self.write_file_atomically(
                            file_name,
                            bytes,
                            ContainedNewFileMode::RespectUmask,
                            ContainedWriteDurability::Rename,
                        ) {
                            Ok(_) => return Ok(()),
                            Err(ContainedFsError::Io(io_err))
                                if io_err.kind() == io::ErrorKind::AlreadyExists =>
                            {
                                continue;
                            }
                            Err(err) => return Err(err),
                        }
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
                let mut file = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
                let stat = fstat_fd(file.as_raw_fd())?;
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
                let live_stat = match fstatat_nofollow(self.fd.as_raw_fd(), &c_target) {
                    Ok(live) => live,
                    Err(error) if error.raw_os_error() == Some(libc::ENOENT) => continue,
                    Err(error) => return Err(ContainedFsError::Io(error)),
                };
                if stat_identity(&live_stat) != stat_identity(&stat) {
                    continue;
                }
                // Clear `O_NONBLOCK` now that `S_ISREG` is verified.
                // SAFETY: `file` is an open regular file descriptor.
                let fl = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFL) };
                if fl >= 0 && (fl & libc::O_NONBLOCK) != 0 {
                    // SAFETY: `file` is an open regular file descriptor.
                    let _ = unsafe {
                        libc::fcntl(file.as_raw_fd(), libc::F_SETFL, fl & !libc::O_NONBLOCK)
                    };
                }
                // SAFETY: `file` is an open writable regular file descriptor.
                if unsafe { libc::ftruncate(file.as_raw_fd(), 0) } != 0 {
                    return Err(ContainedFsError::Io(io::Error::last_os_error()));
                }
                file.write_all(bytes)?;
                file.flush()?;
                // Ensure `S_ISUID` and `S_ISGID` are cleared even on kernels
                // that keep them when the file owner writes in place.
                let after_stat = fstat_fd(file.as_raw_fd())?;
                let after_mode = after_stat.st_mode & 0o7777;
                let stripped_mode = after_mode & !(libc::S_ISUID | libc::S_ISGID);
                if stripped_mode != after_mode {
                    // SAFETY: `file` is an open regular file descriptor.
                    if unsafe { libc::fchmod(file.as_raw_fd(), stripped_mode) } != 0 {
                        return Err(ContainedFsError::Io(io::Error::last_os_error()));
                    }
                }
                return Ok(());
            }
            Err(ContainedFsError::Io(io::Error::other(format!(
                "target \"{}\" changed repeatedly during in-place write",
                file_name.to_string_lossy()
            ))))
        }

        /// Writes `bytes` to a fresh temporary file and atomically publishes
        /// `file_name` inside this directory.
        ///
        /// When replacing an existing file, write permission on the existing
        /// destination is verified without truncating it. The replacement is
        /// staged inside a private `0700` temporary directory (with inherited
        /// ACLs stripped and `setgid` preserved) so no other principal can
        /// observe the temporary file while its content, ownership/group, mode
        /// bits, caller-visible extended attributes, and extended ACLs are
        /// applied and synced before the single atomic `renameat` into place.
        /// If any visible principals, flags, xattrs, or ACLs cannot be
        /// preserved safely, replacement fails without modifying the
        /// destination.
        ///
        /// Note on Linux `trusted.*` attributes: the Linux kernel omits
        /// `trusted.*` extended attributes from `flistxattr` for callers
        /// without `CAP_SYS_ADMIN`, so unprivileged atomic rename cannot detect
        /// or copy hidden `trusted.*` attributes across a new inode. Callers
        /// that require inode-preserving updates on existing files (such as
        /// recompiling `.mjs` outputs) should use [`Self::write_file_in_place`].
        ///
        /// When creating a new file, Linux first uses an unnamed `O_TMPFILE`
        /// handle published via `/proc/self/fd` (handle-based, no-replace, with
        /// native kernel inheritance). Where `O_TMPFILE` is unavailable (macOS,
        /// BSD, or non-`O_TMPFILE` Linux mounts), the temporary file is staged
        /// inside a verified private `0700` directory with `setgid` and
        /// directory ACL inheritance preserved so no other principal can swap
        /// the staged file before no-replace publication. If another writer
        /// creates `file_name` concurrently, creation fails with
        /// [`io::ErrorKind::AlreadyExists`] so callers can re-read and re-merge
        /// rather than silently overwriting the newly created file.
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
            super::validate_writable_file_name(file_name)?;
            let _target_lock = self.lock_target(file_name)?;
            let c_target = os_str_to_cstring(file_name)?;

            for _ in 0..8 {
                let existing = self.open_existing_for_replace(file_name)?;
                enum StageOutcome {
                    Published,
                    Retry,
                }

                let stage_result = if let Some(existing) = existing.as_ref() {
                    let (stage_name, stage_dir, stage_identity) = self.create_staging_dir(false)?;
                    let replace_result = (|| -> Result<StageOutcome, ContainedFsError> {
                        let (temp_name, mut temp_file) = stage_dir.create_temp_file(0o600)?;
                        let mut temp_guard = UnixTempFileGuard::new(&stage_dir, temp_name);
                        let write_result = (|| -> io::Result<()> {
                            strip_inherited_acl(temp_file.as_raw_fd(), false)?;
                            // SAFETY: `temp_file` is an open file descriptor.
                            if unsafe { libc::fchmod(temp_file.as_raw_fd(), 0o600) } != 0 {
                                return Err(io::Error::last_os_error());
                            }
                            #[cfg(target_os = "linux")]
                            apply_linux_pre_write_inode_flags(temp_file.as_raw_fd(), existing)?;
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
                        // Replacing or deleting the target returns a conflict so
                        // callers can re-read and merge instead of discarding a
                        // concurrent edit; only same-inode metadata changes retry.
                        match self.check_destination_snapshot(file_name, existing)? {
                            SnapshotMatch::Unchanged => {}
                            SnapshotMatch::MetadataChanged => return Ok(StageOutcome::Retry),
                            SnapshotMatch::Replaced => {
                                return Err(ContainedFsError::Io(io::Error::new(
                                    io::ErrorKind::AlreadyExists,
                                    format!(
                                        "destination \"{}\" was replaced concurrently before publication",
                                        file_name.to_string_lossy()
                                    ),
                                )));
                            }
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
                    })();
                    drop(stage_dir);
                    let _ = self.rmdir_stage_if_same(&stage_name, stage_identity);
                    replace_result
                } else {
                    let create_mode: libc::c_uint = match new_file_mode {
                        ContainedNewFileMode::RespectUmask => 0o666,
                        ContainedNewFileMode::Private => 0o600,
                    };
                    #[cfg(target_os = "linux")]
                    if let Some(()) = self.try_create_file_via_o_tmpfile(
                        file_name,
                        &c_target,
                        bytes,
                        create_mode,
                        durability,
                    )? {
                        if durability == ContainedWriteDurability::Full
                            && let Err(error) = self.sync_directory()
                        {
                            return Ok(ContainedWriteOutcome::CommittedWithoutDirSync(error));
                        }
                        return Ok(ContainedWriteOutcome::Committed);
                    }

                    let inherited_acl = read_inherited_new_file_acl(self)?;
                    let (stage_name, stage_dir, stage_identity) = self.create_staging_dir(true)?;
                    let create_result = (|| -> Result<StageOutcome, ContainedFsError> {
                        let (temp_name, mut temp_file) = stage_dir.create_temp_file(create_mode)?;
                        let mut temp_guard = UnixTempFileGuard::new(&stage_dir, temp_name);
                        let write_result = (|| -> io::Result<()> {
                            temp_file.write_all(bytes)?;
                            temp_file.flush()?;
                            if let Some(acl) = inherited_acl.as_ref() {
                                apply_existing_acl(temp_file.as_raw_fd(), acl)?;
                            }
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
                            Ok(false) => Err(ContainedFsError::Io(io::Error::new(
                                io::ErrorKind::AlreadyExists,
                                format!(
                                    "destination \"{}\" was created concurrently before publication",
                                    file_name.to_string_lossy()
                                ),
                            ))),
                            Err(error) => Err(ContainedFsError::Io(error)),
                        }
                    })();
                    drop(stage_dir);
                    let _ = self.rmdir_stage_if_same(&stage_name, stage_identity);
                    create_result
                };

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
                #[cfg(any(
                    target_os = "macos",
                    target_os = "ios",
                    target_os = "freebsd",
                    target_os = "netbsd",
                    target_os = "openbsd"
                ))]
                flags: stat.st_flags,
                identity,
            };
            let acl = read_existing_acl(existing_fd.as_raw_fd())?;
            let xattrs = read_existing_user_xattrs(existing_fd.as_raw_fd())?;
            #[cfg(target_os = "linux")]
            let linux_flags = read_linux_inode_flags(existing_fd.as_raw_fd())?;
            #[cfg(target_os = "linux")]
            let linux_fsxattr = read_linux_fsxattr(existing_fd.as_raw_fd())?;
            Ok(Some(ExistingTarget {
                entry,
                acl,
                xattrs,
                #[cfg(target_os = "linux")]
                linux_flags,
                #[cfg(target_os = "linux")]
                linux_fsxattr,
            }))
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
                #[cfg(any(
                    target_os = "macos",
                    target_os = "ios",
                    target_os = "freebsd",
                    target_os = "netbsd",
                    target_os = "openbsd"
                ))]
                flags: stat.st_flags,
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
                let mut hasher = RandomState::new().build_hasher();
                hasher.write_u32(pid);
                hasher.write_u64(nonce);
                let token = hasher.finish();
                let name = OsString::from(format!(".pmds-tmp-{pid}-{nonce}-{token:016x}"));
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

        #[cfg(target_os = "linux")]
        fn try_create_file_via_o_tmpfile(
            &self,
            file_name: &OsStr,
            c_target: &CString,
            bytes: &[u8],
            create_mode: libc::c_uint,
            durability: ContainedWriteDurability,
        ) -> Result<Option<()>, ContainedFsError> {
            let dot = c".";
            // SAFETY: `self.fd` is an open directory descriptor, `dot` is valid,
            // and `create_mode` is promoted to `c_uint`.
            let raw = unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    dot.as_ptr(),
                    libc::O_WRONLY | libc::O_TMPFILE | libc::O_CLOEXEC,
                    create_mode,
                )
            };
            if raw < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.raw_os_error(),
                    Some(
                        libc::EOPNOTSUPP
                            | libc::EISDIR
                            | libc::EINVAL
                            | libc::ENOENT
                            | libc::ENOSYS
                    )
                ) {
                    return Ok(None);
                }
                return Err(ContainedFsError::Io(error));
            }
            // SAFETY: `raw` is a newly opened valid file descriptor.
            let mut temp_file = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
            temp_file.write_all(bytes)?;
            temp_file.flush()?;
            if durability.syncs_file() {
                temp_file.sync_all()?;
            }
            let proc_fd = CString::new(format!("/proc/self/fd/{}", temp_file.as_raw_fd()))
                .map_err(|_| {
                    ContainedFsError::Io(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "invalid procfs descriptor path",
                    ))
                })?;
            // SAFETY: `proc_fd` and `c_target` are valid C strings and `self.fd` is open.
            let rc = unsafe {
                libc::linkat(
                    libc::AT_FDCWD,
                    proc_fd.as_ptr(),
                    self.fd.as_raw_fd(),
                    c_target.as_ptr(),
                    libc::AT_SYMLINK_FOLLOW,
                )
            };
            if rc == 0 {
                return Ok(Some(()));
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EEXIST) {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!(
                        "destination \"{}\" was created concurrently before publication",
                        file_name.to_string_lossy()
                    ),
                )));
            }
            if matches!(
                error.raw_os_error(),
                Some(
                    libc::ENOENT
                        | libc::EXDEV
                        | libc::EOPNOTSUPP
                        | libc::EPERM
                        | libc::EACCES
                        | libc::EINVAL
                        | libc::ENOSYS
                )
            ) {
                return Ok(None);
            }
            Err(ContainedFsError::Io(error))
        }

        fn create_staging_dir(
            &self,
            preserve_default_acl: bool,
        ) -> Result<(CString, Self, FileIdentity), ContainedFsError> {
            let mut parent_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            // SAFETY: `self.fd` is an open directory descriptor and `parent_stat` is writable.
            if unsafe { libc::fstat(self.fd.as_raw_fd(), parent_stat.as_mut_ptr()) } != 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            // SAFETY: `fstat` succeeded and initialized `parent_stat`.
            let parent_stat = unsafe { parent_stat.assume_init() };
            // SAFETY: `geteuid` has no preconditions.
            let euid = unsafe { libc::geteuid() };

            // `mkdirat` followed by `openat` is only safe when no other
            // unprivileged writer can replace entries inside `self` between
            // those two calls: either `self` is a sticky directory owned by
            // `euid` or `root` (e.g. `/tmp`), or `self` is owned by `euid`
            // with no group/other write bits and no foreign-write ACL.
            if !self.parent_allows_safe_staging(&parent_stat, euid)? {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "refusing to stage inside a non-sticky shared writable directory",
                )));
            }

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
                    let error = io::Error::last_os_error();
                    let _ =
                        self.rmdir_created_stage_on_open_error(&c_name, parent_stat.st_dev, euid);
                    return Err(ContainedFsError::Io(error));
                }
                // SAFETY: `raw` is a newly opened valid directory descriptor.
                let fd = unsafe { OwnedFd::from_raw_fd(raw) };

                // Verify that `fd` is genuinely our newly created private empty
                // directory on the same device before mutating its ACL or mode.
                let mut stage_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                // SAFETY: `fd` is open and `stage_stat` is writable.
                if unsafe { libc::fstat(fd.as_raw_fd(), stage_stat.as_mut_ptr()) } != 0 {
                    let error = io::Error::last_os_error();
                    drop(fd);
                    let _ =
                        self.rmdir_created_stage_on_open_error(&c_name, parent_stat.st_dev, euid);
                    return Err(ContainedFsError::Io(error));
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
                    strip_inherited_acl(fd.as_raw_fd(), preserve_default_acl)?;
                    // Inspect mode after stripping ACLs. Skip `fchmod` when
                    // `mkdirat(..., 0o700)` already produced exact owner-only
                    // `0700` permission bits so Linux retains any kernel-inherited
                    // `S_ISGID` bit even when the writer is not a member of the
                    // directory's group.
                    let mut post_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    // SAFETY: `fd` is open and `post_stat` is writable.
                    if unsafe { libc::fstat(fd.as_raw_fd(), post_stat.as_mut_ptr()) } != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    // SAFETY: `fstat` succeeded and initialized `post_stat`.
                    let mut post_stat = unsafe { post_stat.assume_init() };
                    if (post_stat.st_mode & 0o0777) != 0o700 {
                        let target_mode = 0o700 | (post_stat.st_mode & libc::S_ISGID);
                        // SAFETY: `fd` has been verified as our fresh private empty directory.
                        if unsafe { libc::fchmod(fd.as_raw_fd(), target_mode) } != 0 {
                            return Err(io::Error::last_os_error());
                        }
                        let mut rechecked = std::mem::MaybeUninit::<libc::stat>::uninit();
                        // SAFETY: `fd` is open and `rechecked` is writable.
                        if unsafe { libc::fstat(fd.as_raw_fd(), rechecked.as_mut_ptr()) } != 0 {
                            return Err(io::Error::last_os_error());
                        }
                        // SAFETY: `fstat` succeeded and initialized `rechecked`.
                        post_stat = unsafe { rechecked.assume_init() };
                    }
                    // Verify effective mode bits after hardening so mounts that
                    // ignore `fchmod` (for example world-writable non-POSIX
                    // mounts) fail closed rather than exposing staged files.
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
                return Ok((c_name, Self { fd }, identity));
            }
            Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "could not allocate a unique private staging directory",
            )))
        }

        fn parent_allows_safe_staging(
            &self,
            parent_stat: &libc::stat,
            euid: libc::uid_t,
        ) -> io::Result<bool> {
            // Sticky directory owned by the caller or root prevents other
            // unprivileged users from unlinking or renaming our staging entry.
            if (parent_stat.st_mode & libc::S_ISVTX) != 0
                && (parent_stat.st_uid == euid || parent_stat.st_uid == 0)
            {
                return Ok(true);
            }
            if parent_stat.st_uid != euid || (parent_stat.st_mode & 0o0022) != 0 {
                return Ok(false);
            }
            Ok(!parent_has_foreign_write_acl(self)?)
        }

        fn check_destination_snapshot(
            &self,
            file_name: &OsStr,
            expected: &ExistingTarget,
        ) -> Result<SnapshotMatch, ContainedFsError> {
            let Some(current) = self.open_existing_for_replace(file_name)? else {
                return Ok(SnapshotMatch::Replaced);
            };
            if current.entry.identity != expected.entry.identity {
                return Ok(SnapshotMatch::Replaced);
            }
            #[cfg(target_os = "linux")]
            let linux_flags_changed = current.linux_flags != expected.linux_flags
                || current.linux_fsxattr != expected.linux_fsxattr;
            #[cfg(not(target_os = "linux"))]
            let linux_flags_changed = false;
            if current.entry != expected.entry
                || !acl_equals(current.acl.as_ref(), expected.acl.as_ref())?
                || current.xattrs != expected.xattrs
                || linux_flags_changed
            {
                return Ok(SnapshotMatch::MetadataChanged);
            }
            Ok(SnapshotMatch::Unchanged)
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

        fn rmdir_created_stage_on_open_error(
            &self,
            stage_name: &CString,
            expected_dev: libc::dev_t,
            expected_uid: libc::uid_t,
        ) -> io::Result<()> {
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            // SAFETY: `self.fd` is open, `stage_name` is valid, and `stat` is writable.
            if unsafe {
                libc::fstatat(
                    self.fd.as_raw_fd(),
                    stage_name.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: `fstatat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            if (stat.st_mode & libc::S_IFMT) != libc::S_IFDIR
                || stat.st_dev != expected_dev
                || stat.st_uid != expected_uid
            {
                return Ok(());
            }
            // `unlinkat(..., AT_REMOVEDIR)` only removes empty directories.
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

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn probe_directory_case_insensitivity(
        dir: &ContainedDir,
        readable_fd: std::os::fd::RawFd,
    ) -> Option<bool> {
        // SAFETY: `readable_fd` is an open readable directory descriptor.
        let dup_fd = unsafe { libc::fcntl(readable_fd, libc::F_DUPFD_CLOEXEC, 0) };
        if dup_fd < 0 {
            return None;
        }
        // SAFETY: `dup_fd` is valid; `fdopendir` takes ownership on success.
        let dir_ptr = unsafe { libc::fdopendir(dup_fd) };
        if dir_ptr.is_null() {
            // SAFETY: `fdopendir` failed, so we still own `dup_fd`.
            unsafe {
                libc::close(dup_fd);
            }
            return None;
        }

        // Stream directory entries one at a time so normal directories settle
        // in O(1) time and memory on the first ASCII-named entry. Only retain
        // flipped variants for multi-link non-directory entries (which could be
        // hard-linked `Readme`/`readme` pairs on a case-sensitive filesystem).
        let mut ambiguous_variants: Vec<Vec<u8>> = Vec::new();
        let mut result: Option<bool> = None;
        loop {
            // SAFETY: `dir_ptr` is a valid `DIR*`.
            let entry = unsafe { libc::readdir(dir_ptr) };
            if entry.is_null() {
                break;
            }
            // SAFETY: `entry` is non-null and `d_name` is a NUL-terminated C string.
            let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
            if name == c"." || name == c".." {
                continue;
            }
            let Ok(name_str) = std::str::from_utf8(name.to_bytes()) else {
                continue;
            };
            let Some((idx, ch)) = name_str
                .char_indices()
                .find(|(_, ch)| ch.is_ascii_alphabetic())
            else {
                continue;
            };
            let flipped = if ch.is_ascii_lowercase() {
                ch.to_ascii_uppercase()
            } else {
                ch.to_ascii_lowercase()
            };
            let mut variant = String::with_capacity(name_str.len());
            variant.push_str(&name_str[..idx]);
            variant.push(flipped);
            variant.push_str(&name_str[idx + ch.len_utf8()..]);
            let Ok(variant_c) = CString::new(variant.as_bytes()) else {
                continue;
            };
            let Ok(original_stat) = fstatat_nofollow(dir.fd.as_raw_fd(), name) else {
                continue;
            };
            let original_id = stat_identity(&original_stat);
            let variant_id = fstatat_nofollow(dir.fd.as_raw_fd(), &variant_c)
                .ok()
                .map(|stat| stat_identity(&stat));
            if variant_id != Some(original_id) {
                // Either the flipped spelling does not exist or it resolves to
                // a distinct inode: either way, the directory is case-sensitive.
                result = Some(false);
                break;
            }
            let is_dir = (original_stat.st_mode & libc::S_IFMT) == libc::S_IFDIR;
            if is_dir || original_stat.st_nlink <= 1 {
                // Directories cannot be hard-linked on POSIX, and a single-link
                // entry cannot have two distinct names in the directory: equal
                // inodes immediately prove case-insensitivity.
                result = Some(true);
                break;
            }
            ambiguous_variants.push(variant.into_bytes());
        }

        // Only when every ASCII entry was a multi-link hard-linked file do we
        // rewind once to check whether any flipped variant is absent from the
        // directory listing (proving case-insensitivity rather than a pair of
        // hard links).
        if result.is_none() && !ambiguous_variants.is_empty() {
            let mut remaining: HashSet<Vec<u8>> = ambiguous_variants.into_iter().collect();
            // SAFETY: `dir_ptr` is a valid `DIR*`.
            unsafe {
                libc::rewinddir(dir_ptr);
            }
            loop {
                // SAFETY: `dir_ptr` is a valid `DIR*`.
                let entry = unsafe { libc::readdir(dir_ptr) };
                if entry.is_null() {
                    break;
                }
                // SAFETY: `entry` is non-null and `d_name` is a NUL-terminated C string.
                let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
                remaining.remove(name.to_bytes());
                if remaining.is_empty() {
                    break;
                }
            }
            if !remaining.is_empty() {
                result = Some(true);
            }
        }

        // SAFETY: `dir_ptr` is a valid `DIR*` owned by this function.
        unsafe {
            libc::closedir(dir_ptr);
        }
        result
    }

    pub(super) fn stat_identity(stat: &libc::stat) -> FileIdentity {
        #[allow(clippy::unnecessary_cast)]
        FileIdentity {
            dev: stat.st_dev as u64,
            ino: stat.st_ino as u64,
        }
    }

    pub(super) fn fstat_fd(fd: std::os::fd::RawFd) -> io::Result<libc::stat> {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `fd` is an open descriptor and `stat` is writable.
        if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `fstat` succeeded and initialized `stat`.
        Ok(unsafe { stat.assume_init() })
    }

    fn fstatat_nofollow(
        dir_fd: std::os::fd::RawFd,
        name: &std::ffi::CStr,
    ) -> io::Result<libc::stat> {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `dir_fd` is an open directory descriptor, `name` is valid,
        // and `stat` is writable.
        if unsafe {
            libc::fstatat(
                dir_fd,
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `fstatat` succeeded and initialized `stat`.
        Ok(unsafe { stat.assume_init() })
    }

    #[cfg(not(any(target_os = "solaris", target_os = "illumos")))]
    fn flock_exclusive(fd: std::os::fd::RawFd) -> io::Result<()> {
        loop {
            // SAFETY: `fd` is an open file descriptor.
            if unsafe { libc::flock(fd, libc::LOCK_EX) } == 0 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(error);
        }
    }

    #[cfg(not(any(target_os = "solaris", target_os = "illumos")))]
    fn flock_shared(fd: std::os::fd::RawFd) -> io::Result<()> {
        loop {
            // SAFETY: `fd` is an open file descriptor.
            if unsafe { libc::flock(fd, libc::LOCK_SH) } == 0 {
                return Ok(());
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(error);
        }
    }

    #[cfg(not(any(target_os = "solaris", target_os = "illumos")))]
    fn try_flock_exclusive(fd: std::os::fd::RawFd) -> io::Result<bool> {
        // SAFETY: `fd` is an open file descriptor.
        if unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Ok(true);
        }
        let error = io::Error::last_os_error();
        let raw = error.raw_os_error();
        if raw == Some(libc::EWOULDBLOCK) || raw == Some(libc::EAGAIN) || raw == Some(libc::EINTR) {
            return Ok(false);
        }
        Err(error)
    }

    #[cfg(any(target_os = "solaris", target_os = "illumos"))]
    fn flock_exclusive(_fd: std::os::fd::RawFd) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "advisory flock directory locking is not supported on this Unix target",
        ))
    }

    #[cfg(any(target_os = "solaris", target_os = "illumos"))]
    fn flock_shared(_fd: std::os::fd::RawFd) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "advisory flock directory locking is not supported on this Unix target",
        ))
    }

    #[cfg(any(target_os = "solaris", target_os = "illumos"))]
    fn try_flock_exclusive(_fd: std::os::fd::RawFd) -> io::Result<bool> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "advisory flock directory locking is not supported on this Unix target",
        ))
    }

    #[derive(Debug)]
    pub(super) enum ReadonlyRecoveryOutcome {
        /// The abandoned `.pmds-lock` was removed (or replaced by another
        /// writer); the caller should retry normal `.pmds-lock` acquisition.
        LockReleased,
        /// `.pmds-lock` belongs to another UID in a sticky directory and
        /// cannot be unlinked by this user. The caller now holds `LOCK_SH` on
        /// `existing_fd` (blocking the original owner's `LOCK_EX` on
        /// `.pmds-lock`) and `LOCK_EX` on its own `claim_fd` (blocking other
        /// distinct-UID waiters), and will unlink `claim_name` on drop.
        HeldViaClaim {
            claim_name: CString,
            claim_id: FileIdentity,
            claim_fd: OwnedFd,
            existing_fd: OwnedFd,
        },
    }

    fn unlink_unix_dir_lock(dir_raw: std::os::fd::RawFd) -> io::Result<()> {
        // SAFETY: `dir_raw` is open and `UNIX_DIR_LOCK_NAME` is valid.
        if unsafe { libc::unlinkat(dir_raw, UNIX_DIR_LOCK_NAME.as_ptr(), 0) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// Waits for a read-only `.pmds-lock` opened on a filesystem that rejects
    /// `flock(LOCK_EX)` on `O_RDONLY` descriptors (such as Linux NFS). Once
    /// `LOCK_SH` succeeds, no active writer holds `LOCK_EX` on `existing_id`:
    /// if `.pmds-lock` is already gone or replaced, the live writer released it
    /// cleanly; if `.pmds-lock` still names `existing_id`, the previous owner
    /// died without unlinking it and we coordinate atomic single-winner
    /// recovery via a generation-indexed claim chain `.pmds-claim-<ino>-<gen>`
    /// (using only the cross-client `st_ino` fileid, never client-local
    /// `st_dev`).
    ///
    /// When the caller can unlink `.pmds-lock`, it removes the abandoned lock
    /// and cleans up prior claims before returning [`ReadonlyRecoveryOutcome::LockReleased`].
    /// When `.pmds-lock` belongs to a different UID in a root-owned sticky
    /// directory (`unlinkat` returns `EPERM`/`EACCES`), the caller instead
    /// retains `LOCK_SH` on `.pmds-lock` (preventing the original owner from
    /// taking `LOCK_EX`) together with `LOCK_EX` on its own claim file
    /// (serializing all other distinct-UID waiters) and returns
    /// [`ReadonlyRecoveryOutcome::HeldViaClaim`].
    pub(super) fn wait_for_readonly_lock_release(
        dir: &ContainedDir,
        existing_fd: OwnedFd,
        existing_id: FileIdentity,
    ) -> Result<ReadonlyRecoveryOutcome, ContainedFsError> {
        wait_for_readonly_lock_release_with_unlink(
            dir,
            existing_fd,
            existing_id,
            unlink_unix_dir_lock,
        )
    }

    pub(super) fn wait_for_readonly_lock_release_with_unlink<F>(
        dir: &ContainedDir,
        existing_fd: OwnedFd,
        existing_id: FileIdentity,
        unlink_lock: F,
    ) -> Result<ReadonlyRecoveryOutcome, ContainedFsError>
    where
        F: Fn(std::os::fd::RawFd) -> io::Result<()>,
    {
        const MAX_RECOVERY_GENERATIONS: u32 = 64;

        let dir_raw = dir.fd.as_raw_fd();
        flock_shared(existing_fd.as_raw_fd()).map_err(ContainedFsError::Io)?;

        match fstatat_nofollow(dir_raw, UNIX_DIR_LOCK_NAME) {
            Ok(stat) if stat_identity(&stat) == existing_id => {
                if stat.st_nlink > 1 {
                    reclaim_interrupted_lock_temp_links(dir, existing_id);
                    let rechecked = fstat_fd(existing_fd.as_raw_fd())?;
                    if rechecked.st_nlink > 1 {
                        return Err(ContainedFsError::Containment(
                            "refusing to use hard-linked file as catalog lock \".pmds-lock\""
                                .to_owned(),
                        ));
                    }
                }
            }
            Ok(_) => return Ok(ReadonlyRecoveryOutcome::LockReleased),
            Err(error) if error.raw_os_error() == Some(libc::ENOENT) => {
                return Ok(ReadonlyRecoveryOutcome::LockReleased);
            }
            Err(error) => return Err(ContainedFsError::Io(error)),
        }

        // Keep `existing_fd` locked with `LOCK_SH` across recovery so no writer
        // can simultaneously hold `LOCK_EX` on `existing_id`.
        let dir_group_writable = fstat_fd(dir_raw)
            .map(|stat| (stat.st_mode & 0o020) != 0)
            .unwrap_or(false);
        let smb_share = is_smb_share(dir_raw);
        let mut generation: u32 = 0;
        let mut verified_prior_claims: Vec<(CString, FileIdentity)> = Vec::new();

        'recovery: loop {
            match fstatat_nofollow(dir_raw, UNIX_DIR_LOCK_NAME) {
                Ok(stat) if stat_identity(&stat) == existing_id => {}
                Ok(_) => return Ok(ReadonlyRecoveryOutcome::LockReleased),
                Err(error) if error.raw_os_error() == Some(libc::ENOENT) => {
                    return Ok(ReadonlyRecoveryOutcome::LockReleased);
                }
                Err(error) => return Err(ContainedFsError::Io(error)),
            }

            if generation >= MAX_RECOVERY_GENERATIONS {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "exceeded maximum recovery generations for abandoned catalog lock \".pmds-lock\"",
                )));
            }

            // Use `existing_id.ino` (shared NFS fileid) without client-local `st_dev`.
            let claim_name = CString::new(format!(".pmds-claim-{}-{generation}", existing_id.ino))
                .expect("ASCII recovery claim name has no NUL bytes");

            // Create, stamp, and lock the recovery claim file BEFORE publishing
            // it by handle or from a verified private staging directory so no
            // concurrent writer or waiter can swap the entry before publication
            // or observe an unlocked claim file.
            match publish_locked_temp_file(dir, &claim_name, ".pmds-ctmp", dir_group_writable)? {
                LockPublishResult::Published(claim_fd, claim_id) => {
                    let owns_claim = matches!(
                        fstatat_nofollow(dir_raw, &claim_name),
                        Ok(stat) if stat_identity(&stat) == claim_id
                    );
                    if !owns_claim {
                        drop(claim_fd);
                        continue 'recovery;
                    }
                    let mut result = Ok(ReadonlyRecoveryOutcome::LockReleased);
                    let mut main_lock_retired = false;
                    match fstatat_nofollow(dir_raw, UNIX_DIR_LOCK_NAME) {
                        Ok(stat) if stat_identity(&stat) == existing_id => {
                            match unlink_lock(dir_raw) {
                                Ok(()) => {
                                    main_lock_retired = true;
                                }
                                Err(error) => match error.raw_os_error() {
                                    Some(libc::ENOENT) => {
                                        main_lock_retired = true;
                                    }
                                    Some(libc::EPERM | libc::EACCES) => {
                                        // Distinct UID in a sticky directory cannot delete
                                        // another user's `.pmds-lock`. Keep earlier claims
                                        // intact so no concurrent waiter can claim a vacant
                                        // lower generation while we hold `claim_name`, and
                                        // return `HeldViaClaim` holding `LOCK_SH` on
                                        // `existing_fd` plus `LOCK_EX` on `claim_fd`.
                                        return Ok(ReadonlyRecoveryOutcome::HeldViaClaim {
                                            claim_name,
                                            claim_id,
                                            claim_fd,
                                            existing_fd,
                                        });
                                    }
                                    _ => {
                                        result = Err(ContainedFsError::Io(error));
                                    }
                                },
                            }
                        }
                        Ok(_) => {
                            main_lock_retired = true;
                        }
                        Err(error) if error.raw_os_error() == Some(libc::ENOENT) => {
                            main_lock_retired = true;
                        }
                        Err(error) => {
                            result = Err(ContainedFsError::Io(error));
                        }
                    }
                    // Clean up prior-generation claims ONLY after the main
                    // `.pmds-lock` inode has actually been retired so a lower
                    // generation slot can never become vacant while a higher
                    // generation claim is active.
                    if main_lock_retired {
                        for (prior_name, prior_id) in &verified_prior_claims {
                            if let Ok(stat) = fstatat_nofollow(dir_raw, prior_name)
                                && stat_identity(&stat) == *prior_id
                            {
                                // SAFETY: `dir_raw` is open and `prior_name` matches the verified dead claim.
                                unsafe {
                                    let _ = libc::unlinkat(dir_raw, prior_name.as_ptr(), 0);
                                }
                            }
                        }
                    }
                    if let Ok(stat) = fstatat_nofollow(dir_raw, &claim_name)
                        && stat_identity(&stat) == claim_id
                    {
                        // SAFETY: `dir_raw` is open and `claim_name` is verified.
                        unsafe {
                            let _ = libc::unlinkat(dir_raw, claim_name.as_ptr(), 0);
                        }
                    }
                    drop(claim_fd);
                    return result;
                }
                LockPublishResult::AlreadyExists => {}
                LockPublishResult::Unsupported(error) => {
                    return Err(ContainedFsError::Io(error));
                }
            }

            // Another waiter already published `.pmds-claim-<ino>-<gen>`: wait
            // on it via `LOCK_SH` (or bounded polling when a CIFS/SMB mandatory
            // byte-range lock blocks `openat` or `pread`). Never unlink a stale
            // claim directly (which could race with another waiter); instead,
            // if that claimant exited cleanly and unlinked its claim we reuse
            // this generation, and if it died leaving its claim behind we
            // advance to `generation + 1` so serialization stays single-winner.
            let claim_deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            let mut open_backoff_ms: u64 = 2;
            let other_fd = loop {
                // SAFETY: `dir_raw` is open and `claim_name` is a valid C string.
                let other_raw = unsafe {
                    libc::openat(
                        dir_raw,
                        claim_name.as_ptr(),
                        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
                    )
                };
                if other_raw >= 0 {
                    // SAFETY: `other_raw` is a newly opened valid file descriptor.
                    break unsafe { OwnedFd::from_raw_fd(other_raw) };
                }
                let open_err = io::Error::last_os_error();
                let raw_err = open_err.raw_os_error();
                if raw_err == Some(libc::ENOENT) {
                    continue 'recovery;
                }
                if raw_err == Some(libc::ETXTBSY)
                    || (smb_share
                        && (raw_err == Some(libc::EACCES)
                            || raw_err == Some(libc::EAGAIN)
                            || raw_err == Some(libc::EWOULDBLOCK)))
                {
                    match fstatat_nofollow(dir_raw, UNIX_DIR_LOCK_NAME) {
                        Ok(stat) if stat_identity(&stat) == existing_id => {}
                        Ok(_) => return Ok(ReadonlyRecoveryOutcome::LockReleased),
                        Err(err) if err.raw_os_error() == Some(libc::ENOENT) => {
                            return Ok(ReadonlyRecoveryOutcome::LockReleased);
                        }
                        Err(err) => return Err(ContainedFsError::Io(err)),
                    }
                    match fstatat_nofollow(dir_raw, &claim_name) {
                        Ok(_) => {}
                        Err(err) if err.raw_os_error() == Some(libc::ENOENT) => {
                            continue 'recovery;
                        }
                        Err(err) => return Err(ContainedFsError::Io(err)),
                    }
                    if std::time::Instant::now() >= claim_deadline {
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "timed out waiting for exclusive SMB recovery claim to release",
                        )));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(open_backoff_ms));
                    open_backoff_ms = (open_backoff_ms * 2).min(50);
                    continue;
                }
                return Err(ContainedFsError::Io(open_err));
            };

            let other_stat = fstat_fd(other_fd.as_raw_fd())?;
            if (other_stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "refusing to overwrite or remove pre-existing non-lock recovery claim file",
                )));
            }
            let other_id = stat_identity(&other_stat);
            let mut magic_backoff_ms: u64 = 2;
            loop {
                let cur_stat = fstat_fd(other_fd.as_raw_fd())?;
                match verify_lock_file_magic(other_fd.as_raw_fd(), &cur_stat) {
                    Ok(true) => break,
                    Ok(false) => {
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            "refusing to overwrite or remove pre-existing non-lock recovery claim file",
                        )));
                    }
                    Err(read_err)
                        if read_err.raw_os_error() == Some(libc::EACCES)
                            || read_err.raw_os_error() == Some(libc::EAGAIN)
                            || read_err.raw_os_error() == Some(libc::EWOULDBLOCK) =>
                    {
                        // Mandatory SMB byte-range locking can reject `pread`
                        // while the winning claimant holds its exclusive lock.
                        // Wait with bounded backoff while rechecking both
                        // `.pmds-lock` and the claim identity.
                        match fstatat_nofollow(dir_raw, UNIX_DIR_LOCK_NAME) {
                            Ok(stat) if stat_identity(&stat) == existing_id => {}
                            Ok(_) => return Ok(ReadonlyRecoveryOutcome::LockReleased),
                            Err(err) if err.raw_os_error() == Some(libc::ENOENT) => {
                                return Ok(ReadonlyRecoveryOutcome::LockReleased);
                            }
                            Err(err) => return Err(ContainedFsError::Io(err)),
                        }
                        match fstatat_nofollow(dir_raw, &claim_name) {
                            Ok(stat) if stat_identity(&stat) == other_id => {}
                            Ok(_) => continue 'recovery,
                            Err(err) if err.raw_os_error() == Some(libc::ENOENT) => {
                                continue 'recovery;
                            }
                            Err(err) => return Err(ContainedFsError::Io(err)),
                        }
                        if std::time::Instant::now() >= claim_deadline {
                            return Err(ContainedFsError::Io(io::Error::new(
                                io::ErrorKind::TimedOut,
                                "timed out waiting for mandatory lock on recovery claim to release",
                            )));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(magic_backoff_ms));
                        magic_backoff_ms = (magic_backoff_ms * 2).min(50);
                    }
                    Err(read_err) => return Err(ContainedFsError::Io(read_err)),
                }
            }
            flock_shared(other_fd.as_raw_fd()).map_err(ContainedFsError::Io)?;
            let still_abandoned = match fstatat_nofollow(dir_raw, UNIX_DIR_LOCK_NAME) {
                Ok(stat) => stat_identity(&stat) == existing_id,
                Err(err) if err.raw_os_error() == Some(libc::ENOENT) => false,
                Err(err) => return Err(ContainedFsError::Io(err)),
            };
            if !still_abandoned {
                return Ok(ReadonlyRecoveryOutcome::LockReleased);
            }
            // If the previous claimant exited cleanly and unlinked its own
            // claim file before releasing `LOCK_EX`, reuse this generation
            // slot rather than advancing indefinitely.
            let claim_still_present = match fstatat_nofollow(dir_raw, &claim_name) {
                Ok(stat) => stat_identity(&stat) == other_id,
                Err(err) if err.raw_os_error() == Some(libc::ENOENT) => false,
                Err(err) => return Err(ContainedFsError::Io(err)),
            };
            if !claim_still_present {
                continue 'recovery;
            }
            verified_prior_claims.push((claim_name, other_id));
            generation += 1;
        }
    }

    enum MandatoryLockOutcome {
        RetryOuter,
        AcquiredExclusive,
        ReadyForReadonlyRecovery,
    }

    fn wait_for_mandatory_lock_acquisition(
        dir: &ContainedDir,
        existing_fd: &OwnedFd,
        existing_id: FileIdentity,
        opened_read_only: bool,
    ) -> Result<MandatoryLockOutcome, ContainedFsError> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let mut backoff_ms: u64 = 2;
        loop {
            match fstatat_nofollow(dir.fd.as_raw_fd(), UNIX_DIR_LOCK_NAME) {
                Ok(stat) if stat_identity(&stat) == existing_id => {}
                Ok(_) => return Ok(MandatoryLockOutcome::RetryOuter),
                Err(error) if error.raw_os_error() == Some(libc::ENOENT) => {
                    return Ok(MandatoryLockOutcome::RetryOuter);
                }
                Err(error) => return Err(ContainedFsError::Io(error)),
            }

            if !opened_read_only {
                if try_flock_exclusive(existing_fd.as_raw_fd()).map_err(ContainedFsError::Io)? {
                    return Ok(MandatoryLockOutcome::AcquiredExclusive);
                }
            } else {
                // Retry reading the lock signature so a read-only SMB waiter
                // detects as soon as the holder exits or crashes and lifts its
                // mandatory lock, then transitions directly into read-only
                // recovery instead of timing out.
                let cur_stat = fstat_fd(existing_fd.as_raw_fd())?;
                match verify_lock_file_magic(existing_fd.as_raw_fd(), &cur_stat) {
                    Ok(true) => return Ok(MandatoryLockOutcome::ReadyForReadonlyRecovery),
                    Ok(false) => {
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            "refusing to overwrite or remove pre-existing non-lock file \".pmds-lock\"",
                        )));
                    }
                    Err(read_err)
                        if read_err.raw_os_error() == Some(libc::EACCES)
                            || read_err.raw_os_error() == Some(libc::EAGAIN)
                            || read_err.raw_os_error() == Some(libc::EWOULDBLOCK) => {}
                    Err(read_err) => return Err(ContainedFsError::Io(read_err)),
                }
            }

            if std::time::Instant::now() >= deadline {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "timed out waiting for mandatory lock on \".pmds-lock\" to release",
                )));
            }
            std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
            backoff_ms = (backoff_ms * 2).min(50);
        }
    }

    fn write_all_fd(fd: std::os::fd::RawFd, mut bytes: &[u8]) -> io::Result<()> {
        while !bytes.is_empty() {
            // SAFETY: `fd` is open and `bytes` is readable for `bytes.len()`.
            let written = unsafe { libc::write(fd, bytes.as_ptr().cast(), bytes.len()) };
            if written < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::EINTR) {
                    continue;
                }
                return Err(error);
            }
            if written == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "failed to write catalog lock signature",
                ));
            }
            #[allow(clippy::cast_sign_loss)]
            let advance = written as usize;
            bytes = &bytes[advance..];
        }
        Ok(())
    }

    fn verify_lock_file_magic(fd: std::os::fd::RawFd, stat: &libc::stat) -> io::Result<bool> {
        let expected_len = UNIX_DIR_LOCK_MAGIC.len();
        #[allow(clippy::cast_possible_wrap)]
        if stat.st_size != expected_len as libc::off_t {
            return Ok(false);
        }
        let mut buf = [0u8; 32];
        let mut total = 0usize;
        while total < expected_len + 1 {
            #[allow(clippy::cast_possible_wrap)]
            let offset = total as libc::off_t;
            // SAFETY: `fd` is open and `buf[total..]` is writable.
            let read = unsafe {
                libc::pread(
                    fd,
                    buf[total..].as_mut_ptr().cast(),
                    (expected_len + 1) - total,
                    offset,
                )
            };
            if read < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::EINTR) {
                    continue;
                }
                return Err(error);
            }
            if read == 0 {
                break;
            }
            #[allow(clippy::cast_sign_loss)]
            {
                total += read as usize;
            }
        }
        Ok(total == expected_len && &buf[..expected_len] == UNIX_DIR_LOCK_MAGIC)
    }

    const UNIX_DIR_LOCK_TEMP_PREFIX: &[u8] = b".pmds-ltmp-";
    const UNIX_STAGE_DIR_PREFIX: &[u8] = b".pmds-stage-";

    /// Removes stale `.pmds-ltmp-*` hard links (either directly in `dir` or
    /// inside an owned `.pmds-stage-*` directory) left behind if a previous
    /// writer crashed between `linkat` and `unlinkat` on platforms without
    /// atomic no-replace rename. Only unlinks entries whose name starts with
    /// `.pmds-ltmp-` and whose `(dev, ino)` matches our locked, magic-verified
    /// `.pmds-lock` inode, so unrelated user files are never touched.
    fn reclaim_interrupted_lock_temp_links(dir: &ContainedDir, lock_id: FileIdentity) {
        let Some(readable) = open_readable_self(dir) else {
            return;
        };
        // SAFETY: `readable` is an open readable directory descriptor.
        let dup_fd = unsafe { libc::fcntl(readable.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if dup_fd < 0 {
            return;
        }
        // SAFETY: `dup_fd` is valid; `fdopendir` takes ownership on success.
        let dir_ptr = unsafe { libc::fdopendir(dup_fd) };
        if dir_ptr.is_null() {
            // SAFETY: `fdopendir` failed, so we still own `dup_fd`.
            unsafe {
                libc::close(dup_fd);
            }
            return;
        }
        // SAFETY: `geteuid` has no preconditions.
        let euid = unsafe { libc::geteuid() };
        let mut stale_names: Vec<CString> = Vec::new();
        let mut stage_dirs: Vec<(CString, FileIdentity)> = Vec::new();
        loop {
            // SAFETY: `dir_ptr` is a valid `DIR*`.
            let entry = unsafe { libc::readdir(dir_ptr) };
            if entry.is_null() {
                break;
            }
            // SAFETY: `entry` is non-null and `d_name` is a NUL-terminated C string.
            let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
            if name.to_bytes().starts_with(UNIX_DIR_LOCK_TEMP_PREFIX) {
                if let Ok(stat) = fstatat_nofollow(dir.fd.as_raw_fd(), name)
                    && stat_identity(&stat) == lock_id
                {
                    stale_names.push(name.to_owned());
                }
            } else if name.to_bytes().starts_with(UNIX_STAGE_DIR_PREFIX)
                && let Ok(stat) = fstatat_nofollow(dir.fd.as_raw_fd(), name)
                && (stat.st_mode & libc::S_IFMT) == libc::S_IFDIR
                && stat.st_uid == euid
                && (stat.st_mode & 0o0077) == 0
            {
                stage_dirs.push((name.to_owned(), stat_identity(&stat)));
            }
        }
        // SAFETY: `dir_ptr` is a valid `DIR*` owned by this function.
        unsafe {
            libc::closedir(dir_ptr);
        }
        for stale in stale_names {
            // SAFETY: `dir.fd` is open and `stale` is a verified `.pmds-ltmp-*` C string.
            unsafe {
                let _ = libc::unlinkat(dir.fd.as_raw_fd(), stale.as_ptr(), 0);
            }
        }
        for (stage_name, stage_id) in stage_dirs {
            // SAFETY: `dir.fd` is open and `stage_name` is a verified owned private stage dir.
            let stage_raw = unsafe {
                libc::openat(
                    dir.fd.as_raw_fd(),
                    stage_name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if stage_raw < 0 {
                continue;
            }
            // SAFETY: `stage_raw` is a newly opened valid directory descriptor.
            let stage_fd = unsafe { OwnedFd::from_raw_fd(stage_raw) };
            if fstat_fd(stage_fd.as_raw_fd())
                .map(|st| {
                    (st.st_mode & libc::S_IFMT) == libc::S_IFDIR
                        && stat_identity(&st) == stage_id
                        && st.st_uid == euid
                        && (st.st_mode & 0o0077) == 0
                })
                .unwrap_or(false)
            {
                // SAFETY: `stage_fd` is an open readable directory descriptor.
                let stage_dup =
                    unsafe { libc::fcntl(stage_fd.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
                if stage_dup >= 0 {
                    // SAFETY: `stage_dup` is valid; `fdopendir` takes ownership on success.
                    let stage_ptr = unsafe { libc::fdopendir(stage_dup) };
                    if stage_ptr.is_null() {
                        // SAFETY: `fdopendir` failed, so we still own `stage_dup`.
                        unsafe {
                            libc::close(stage_dup);
                        }
                    } else {
                        let mut inner_stale: Vec<CString> = Vec::new();
                        loop {
                            // SAFETY: `stage_ptr` is a valid `DIR*`.
                            let entry = unsafe { libc::readdir(stage_ptr) };
                            if entry.is_null() {
                                break;
                            }
                            // SAFETY: `entry` is non-null and `d_name` is a valid C string.
                            let name =
                                unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
                            if name.to_bytes().starts_with(UNIX_DIR_LOCK_TEMP_PREFIX)
                                && let Ok(stat) = fstatat_nofollow(stage_fd.as_raw_fd(), name)
                                && stat_identity(&stat) == lock_id
                            {
                                inner_stale.push(name.to_owned());
                            }
                        }
                        // SAFETY: `stage_ptr` is a valid `DIR*` owned by this function.
                        unsafe {
                            libc::closedir(stage_ptr);
                        }
                        let removed_any = !inner_stale.is_empty();
                        for stale in inner_stale {
                            // SAFETY: `stage_fd` is open and `stale` is a verified `.pmds-ltmp-*`.
                            unsafe {
                                let _ = libc::unlinkat(stage_fd.as_raw_fd(), stale.as_ptr(), 0);
                            }
                        }
                        drop(stage_fd);
                        if removed_any {
                            let _ = dir.rmdir_stage_if_same(&stage_name, stage_id);
                        }
                        continue;
                    }
                }
            }
            drop(stage_fd);
        }
    }

    enum LockPublishResult {
        Published(OwnedFd, FileIdentity),
        AlreadyExists,
        Unsupported(io::Error),
    }

    fn adjust_lock_file_mode(fd: std::os::fd::RawFd, dir_group_writable: bool) {
        // Ensure the lock file is at least 0644 (and 0664 in group-writable
        // directories, never world-writable) so other authorized users in
        // shared sticky directories can open it (`O_RDWR` for same-group NFS
        // locking, or `O_RDONLY` fallback) even under a 0022/0077 umask.
        if let Ok(stat) = fstat_fd(fd) {
            let mut target_mode = (stat.st_mode & 0o664) | 0o644;
            if dir_group_writable {
                target_mode |= 0o020;
            }
            if (stat.st_mode & 0o777) != target_mode {
                // SAFETY: `fd` is an open file descriptor we just created.
                let _ = unsafe { libc::fchmod(fd, target_mode) };
            }
        }
    }

    fn verify_dir_allows_lock_publication(dir: &ContainedDir) -> Result<bool, ContainedFsError> {
        let parent_stat = fstat_fd(dir.fd.as_raw_fd())?;
        // SAFETY: `geteuid` has no preconditions.
        let euid = unsafe { libc::geteuid() };
        if !dir.parent_allows_safe_staging(&parent_stat, euid)? {
            return Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "refusing to acquire catalog lock in non-sticky shared writable directory",
            )));
        }
        Ok((parent_stat.st_mode & 0o020) != 0)
    }

    /// Creates, stamps, and exclusively locks a temporary lock/claim file, then
    /// publishes it to `target_name` inside `dir` without overwriting any
    /// existing entry.
    ///
    /// On Linux, first attempts handle-based unnamed `O_TMPFILE` publication
    /// via `/proc/self/fd` (zero staging directory entry). Otherwise stages the
    /// file inside a verified private `0700` staging directory (`create_staging_dir`)
    /// so no concurrent principal can swap the entry before publication, and
    /// verifies that the published `target_name` inode matches the locked
    /// descriptor before returning `LockPublishResult::Published`.
    fn publish_locked_temp_file(
        dir: &ContainedDir,
        target_name: &std::ffi::CStr,
        temp_prefix: &str,
        dir_group_writable: bool,
    ) -> Result<LockPublishResult, ContainedFsError> {
        verify_dir_allows_lock_publication(dir)?;

        #[cfg(target_os = "linux")]
        {
            let dot = c".";
            // SAFETY: `dir.fd` is open and `dot` is a valid C string.
            let raw = unsafe {
                libc::openat(
                    dir.fd.as_raw_fd(),
                    dot.as_ptr(),
                    libc::O_TMPFILE | libc::O_RDWR | libc::O_CLOEXEC,
                    0o664 as libc::c_uint,
                )
            };
            if raw >= 0 {
                // SAFETY: `raw` is a newly opened unnamed file descriptor.
                let temp_fd = unsafe { OwnedFd::from_raw_fd(raw) };
                adjust_lock_file_mode(temp_fd.as_raw_fd(), dir_group_writable);
                write_all_fd(temp_fd.as_raw_fd(), UNIX_DIR_LOCK_MAGIC)?;
                flock_exclusive(temp_fd.as_raw_fd()).map_err(ContainedFsError::Io)?;
                let temp_id = stat_identity(&fstat_fd(temp_fd.as_raw_fd())?);
                let proc_path = CString::new(format!("/proc/self/fd/{}", temp_fd.as_raw_fd()))
                    .expect("proc fd path has no NUL bytes");
                // SAFETY: `proc_path` and `target_name` are valid C strings;
                // `dir.fd` is an open directory descriptor.
                let rc = unsafe {
                    libc::linkat(
                        libc::AT_FDCWD,
                        proc_path.as_ptr(),
                        dir.fd.as_raw_fd(),
                        target_name.as_ptr(),
                        libc::AT_SYMLINK_FOLLOW,
                    )
                };
                if rc == 0 {
                    let published_matches = matches!(
                        fstatat_nofollow(dir.fd.as_raw_fd(), target_name),
                        Ok(stat) if stat_identity(&stat) == temp_id
                    );
                    if published_matches {
                        return Ok(LockPublishResult::Published(temp_fd, temp_id));
                    }
                    return Ok(LockPublishResult::AlreadyExists);
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::EEXIST) {
                    return Ok(LockPublishResult::AlreadyExists);
                }
                if !matches!(
                    error.raw_os_error(),
                    Some(
                        libc::ENOENT
                            | libc::EACCES
                            | libc::EPERM
                            | libc::EXDEV
                            | libc::ENOSYS
                            | libc::EOPNOTSUPP
                            | libc::EINVAL
                    )
                ) {
                    return Err(ContainedFsError::Io(error));
                }
            }
        }

        let (stage_name, stage_dir, stage_identity) = dir.create_staging_dir(false)?;
        let pid = std::process::id();
        let publish_result = (|| -> Result<LockPublishResult, ContainedFsError> {
            let (temp_name, temp_fd) = loop {
                let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                let temp_name = CString::new(format!("{temp_prefix}-{pid}-{nonce}"))
                    .expect("ASCII temp lock name has no NUL bytes");
                // SAFETY: `stage_dir.fd` is our private 0700 staging directory.
                let temp_raw = unsafe {
                    libc::openat(
                        stage_dir.fd.as_raw_fd(),
                        temp_name.as_ptr(),
                        libc::O_RDWR
                            | libc::O_CREAT
                            | libc::O_EXCL
                            | libc::O_NOFOLLOW
                            | libc::O_CLOEXEC,
                        0o664 as libc::c_uint,
                    )
                };
                if temp_raw >= 0 {
                    // SAFETY: `temp_raw` is a newly opened valid file descriptor.
                    break (temp_name, unsafe { OwnedFd::from_raw_fd(temp_raw) });
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::EEXIST) {
                    return Err(ContainedFsError::Io(error));
                }
            };
            let mut temp_guard = UnixTempFileGuard::new(&stage_dir, temp_name.clone());
            adjust_lock_file_mode(temp_fd.as_raw_fd(), dir_group_writable);
            write_all_fd(temp_fd.as_raw_fd(), UNIX_DIR_LOCK_MAGIC)?;
            flock_exclusive(temp_fd.as_raw_fd()).map_err(ContainedFsError::Io)?;
            let temp_id = stat_identity(&fstat_fd(temp_fd.as_raw_fd())?);

            match publish_file_noreplace(
                stage_dir.fd.as_raw_fd(),
                &temp_name,
                dir.fd.as_raw_fd(),
                target_name,
            ) {
                Ok(true) => {
                    temp_guard.disarm();
                    let published_matches = matches!(
                        fstatat_nofollow(dir.fd.as_raw_fd(), target_name),
                        Ok(stat) if stat_identity(&stat) == temp_id
                    );
                    if published_matches {
                        Ok(LockPublishResult::Published(temp_fd, temp_id))
                    } else {
                        Ok(LockPublishResult::AlreadyExists)
                    }
                }
                Ok(false) => {
                    drop(temp_guard);
                    drop(temp_fd);
                    Ok(LockPublishResult::AlreadyExists)
                }
                Err(error)
                    if matches!(
                        error.raw_os_error(),
                        Some(libc::EPERM | libc::EOPNOTSUPP | libc::ENOSYS | libc::EXDEV)
                    ) =>
                {
                    drop(temp_guard);
                    drop(temp_fd);
                    Ok(LockPublishResult::Unsupported(error))
                }
                Err(error) => {
                    drop(temp_guard);
                    drop(temp_fd);
                    Err(ContainedFsError::Io(error))
                }
            }
        })();
        drop(stage_dir);
        let _ = dir.rmdir_stage_if_same(&stage_name, stage_identity);
        publish_result
    }

    fn is_smb_share(dir_fd: std::os::fd::RawFd) -> bool {
        #[cfg(target_os = "linux")]
        {
            let mut fs_stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
            // SAFETY: `dir_fd` is open and `fs_stat` is writable.
            if unsafe { libc::fstatfs(dir_fd, fs_stat.as_mut_ptr()) } == 0 {
                // SAFETY: `fstatfs` succeeded and initialized `fs_stat`.
                let fs_stat = unsafe { fs_stat.assume_init() };
                #[allow(
                    clippy::cast_possible_truncation,
                    clippy::cast_sign_loss,
                    clippy::unnecessary_cast
                )]
                let f_type = fs_stat.f_type as u32;
                return super::is_linux_smb_magic(f_type);
            }
            false
        }
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
        {
            let mut fs_stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
            // SAFETY: `dir_fd` is open and `fs_stat` is writable.
            if unsafe { libc::fstatfs(dir_fd, fs_stat.as_mut_ptr()) } == 0 {
                // SAFETY: `fstatfs` succeeded and initialized `fs_stat`.
                let fs_stat = unsafe { fs_stat.assume_init() };
                // SAFETY: `f_fstypename` is a NUL-terminated fixed C char array.
                let fs_name = unsafe { std::ffi::CStr::from_ptr(fs_stat.f_fstypename.as_ptr()) };
                return fs_name.to_bytes().eq_ignore_ascii_case(b"smbfs");
            }
            false
        }
        #[cfg(not(any(
            target_os = "linux",
            target_os = "macos",
            target_os = "ios",
            target_os = "freebsd"
        )))]
        {
            let _ = dir_fd;
            false
        }
    }

    fn acquire_unix_dir_lock(
        dir: &ContainedDir,
        key: FileIdentity,
    ) -> Result<UnixDirLock, ContainedFsError> {
        let dir_group_writable = verify_dir_allows_lock_publication(dir)?;
        // Duplicate the directory handle so `Drop` can unlink `.pmds-lock`
        // even if the caller drops `ContainedDir` before `ContainedTargetLock`.
        // SAFETY: `dir.fd` is an open directory descriptor.
        let dup_raw = unsafe { libc::fcntl(dir.fd.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if dup_raw < 0 {
            return Err(ContainedFsError::Io(io::Error::last_os_error()));
        }
        // SAFETY: `dup_raw` is a newly duplicated valid file descriptor.
        let dir_fd = unsafe { OwnedFd::from_raw_fd(dup_raw) };
        let smb_share = is_smb_share(dir.fd.as_raw_fd());
        let mut smb_open_deadline: Option<std::time::Instant> = None;
        let mut smb_open_backoff_ms: u64 = 2;

        loop {
            match publish_locked_temp_file(
                dir,
                UNIX_DIR_LOCK_NAME,
                ".pmds-ltmp",
                dir_group_writable,
            )? {
                LockPublishResult::Published(temp_fd, temp_id) => {
                    verify_dir_allows_lock_publication(dir)?;
                    return Ok(UnixDirLock {
                        key,
                        cleanup: Some((dir_fd, UNIX_DIR_LOCK_NAME.to_owned(), temp_id)),
                        _fd: temp_fd,
                        _secondary_fd: None,
                    });
                }
                LockPublishResult::AlreadyExists => {}
                LockPublishResult::Unsupported(_) => {
                    // Filesystems without atomic no-replace rename or hard
                    // links (e.g. FAT32/exFAT/VFAT) fall back to locking the
                    // directory handle directly (only reached when the parent
                    // directory passed `verify_dir_allows_lock_publication`).
                    let fallback_fd = open_unix_lock_fd(dir)?;
                    flock_exclusive(fallback_fd.as_raw_fd())?;
                    return Ok(UnixDirLock {
                        key,
                        cleanup: None,
                        _fd: fallback_fd,
                        _secondary_fd: None,
                    });
                }
            }

            // `.pmds-lock` already exists: try `O_RDWR` first (needed for Linux
            // NFS remote `flock`), falling back to `O_RDONLY` on `EACCES` so
            // another authorized user in a shared sticky directory can still
            // wait on the owner's `0644` lock file.
            let mut opened_read_only = false;
            // SAFETY: `dir.fd` is open and `UNIX_DIR_LOCK_NAME` is valid.
            let mut existing_raw = unsafe {
                libc::openat(
                    dir.fd.as_raw_fd(),
                    UNIX_DIR_LOCK_NAME.as_ptr(),
                    libc::O_RDWR | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
                )
            };
            if existing_raw < 0 && io::Error::last_os_error().raw_os_error() == Some(libc::EACCES) {
                opened_read_only = true;
                // SAFETY: `dir.fd` is open and `UNIX_DIR_LOCK_NAME` is valid.
                existing_raw = unsafe {
                    libc::openat(
                        dir.fd.as_raw_fd(),
                        UNIX_DIR_LOCK_NAME.as_ptr(),
                        libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
                    )
                };
            }
            if existing_raw < 0 {
                let error = io::Error::last_os_error();
                let raw_err = error.raw_os_error();
                match raw_err {
                    Some(libc::ENOENT) => continue,
                    Some(libc::ELOOP) => {
                        return Err(ContainedFsError::Containment(
                            "refusing to use symlink as catalog lock \".pmds-lock\"".to_owned(),
                        ));
                    }
                    Some(libc::EISDIR) => {
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            "refusing to overwrite existing directory \".pmds-lock\"",
                        )));
                    }
                    _ if raw_err == Some(libc::ETXTBSY)
                        || (smb_share
                            && (raw_err == Some(libc::EACCES)
                                || raw_err == Some(libc::EAGAIN)
                                || raw_err == Some(libc::EWOULDBLOCK))) =>
                    {
                        // A Windows writer on an SMB share opens `.pmds-lock`
                        // with zero share access, which causes `openat` itself
                        // to fail with `EACCES`/`ETXTBSY` until the Windows
                        // holder releases and deletes the lock.
                        match fstatat_nofollow(dir.fd.as_raw_fd(), UNIX_DIR_LOCK_NAME) {
                            Ok(stat) if (stat.st_mode & libc::S_IFMT) == libc::S_IFLNK => {
                                return Err(ContainedFsError::Containment(
                                    "refusing to use symlink as catalog lock \".pmds-lock\""
                                        .to_owned(),
                                ));
                            }
                            Ok(stat) if (stat.st_mode & libc::S_IFMT) == libc::S_IFDIR => {
                                return Err(ContainedFsError::Io(io::Error::new(
                                    io::ErrorKind::AlreadyExists,
                                    "refusing to overwrite existing directory \".pmds-lock\"",
                                )));
                            }
                            Err(stat_err) if stat_err.raw_os_error() == Some(libc::ENOENT) => {
                                continue;
                            }
                            _ => {}
                        }
                        let deadline = *smb_open_deadline.get_or_insert_with(|| {
                            std::time::Instant::now() + std::time::Duration::from_secs(30)
                        });
                        if std::time::Instant::now() >= deadline {
                            return Err(ContainedFsError::Io(io::Error::new(
                                io::ErrorKind::TimedOut,
                                "timed out waiting for exclusive SMB catalog lock \".pmds-lock\"",
                            )));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(smb_open_backoff_ms));
                        smb_open_backoff_ms = (smb_open_backoff_ms * 2).min(50);
                        continue;
                    }
                    _ => return Err(ContainedFsError::Io(error)),
                }
            }
            // SAFETY: `existing_raw` is a newly opened valid file descriptor.
            let existing_fd = unsafe { OwnedFd::from_raw_fd(existing_raw) };
            let pre_stat = fstat_fd(existing_fd.as_raw_fd())?;
            if (pre_stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
                return Err(ContainedFsError::Containment(
                    "refusing to use non-regular file as catalog lock \".pmds-lock\"".to_owned(),
                ));
            }
            // Palamedes always stamps `UNIX_DIR_LOCK_MAGIC` before publishing
            // `.pmds-lock`, so reject foreign files immediately instead of
            // blocking indefinitely if another process holds a lock on one.
            // On Linux CIFS mounts with mandatory SMB byte-range locks, `pread`
            // can return `EACCES`/`EAGAIN` while another writer owns the lock;
            // serialize with a bounded wait and revalidate magic + identity
            // after acquisition.
            let already_locked = match verify_lock_file_magic(existing_fd.as_raw_fd(), &pre_stat) {
                Ok(true) => false,
                Ok(false) => {
                    return Err(ContainedFsError::Io(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "refusing to overwrite or remove pre-existing non-lock file \".pmds-lock\"",
                    )));
                }
                Err(read_err)
                    if read_err.raw_os_error() == Some(libc::EACCES)
                        || read_err.raw_os_error() == Some(libc::EAGAIN)
                        || read_err.raw_os_error() == Some(libc::EWOULDBLOCK) =>
                {
                    let existing_id = stat_identity(&pre_stat);
                    match wait_for_mandatory_lock_acquisition(
                        dir,
                        &existing_fd,
                        existing_id,
                        opened_read_only,
                    )? {
                        MandatoryLockOutcome::RetryOuter => continue,
                        MandatoryLockOutcome::AcquiredExclusive => true,
                        MandatoryLockOutcome::ReadyForReadonlyRecovery => {
                            match wait_for_readonly_lock_release(dir, existing_fd, existing_id)? {
                                ReadonlyRecoveryOutcome::LockReleased => continue,
                                ReadonlyRecoveryOutcome::HeldViaClaim {
                                    claim_name,
                                    claim_id,
                                    claim_fd,
                                    existing_fd,
                                } => {
                                    verify_dir_allows_lock_publication(dir)?;
                                    return Ok(UnixDirLock {
                                        key,
                                        cleanup: Some((dir_fd, claim_name, claim_id)),
                                        _fd: claim_fd,
                                        _secondary_fd: Some(existing_fd),
                                    });
                                }
                            }
                        }
                    }
                }
                Err(read_err) => return Err(ContainedFsError::Io(read_err)),
            };
            if !already_locked && let Err(lock_err) = flock_exclusive(existing_fd.as_raw_fd()) {
                if opened_read_only
                    && matches!(
                        lock_err.raw_os_error(),
                        Some(libc::EBADF | libc::EACCES | libc::EINVAL)
                    )
                {
                    let existing_id = stat_identity(&pre_stat);
                    match wait_for_readonly_lock_release(dir, existing_fd, existing_id)? {
                        ReadonlyRecoveryOutcome::LockReleased => continue,
                        ReadonlyRecoveryOutcome::HeldViaClaim {
                            claim_name,
                            claim_id,
                            claim_fd,
                            existing_fd,
                        } => {
                            verify_dir_allows_lock_publication(dir)?;
                            return Ok(UnixDirLock {
                                key,
                                cleanup: Some((dir_fd, claim_name, claim_id)),
                                _fd: claim_fd,
                                _secondary_fd: Some(existing_fd),
                            });
                        }
                    }
                }
                return Err(ContainedFsError::Io(lock_err));
            }

            let mut post_stat = fstat_fd(existing_fd.as_raw_fd())?;
            let fd_id = stat_identity(&post_stat);
            match fstatat_nofollow(dir.fd.as_raw_fd(), UNIX_DIR_LOCK_NAME) {
                Ok(dir_stat) if stat_identity(&dir_stat) == fd_id => {}
                Ok(_) => continue,
                Err(error) if error.raw_os_error() == Some(libc::ENOENT) => continue,
                Err(error) => return Err(ContainedFsError::Io(error)),
            }
            if !verify_lock_file_magic(existing_fd.as_raw_fd(), &post_stat)? {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "refusing to overwrite or remove pre-existing non-lock file \".pmds-lock\"",
                )));
            }
            if post_stat.st_nlink > 1 {
                reclaim_interrupted_lock_temp_links(dir, fd_id);
                post_stat = fstat_fd(existing_fd.as_raw_fd())?;
                if post_stat.st_nlink > 1 {
                    return Err(ContainedFsError::Containment(
                        "refusing to use hard-linked file as catalog lock \".pmds-lock\""
                            .to_owned(),
                    ));
                }
            }
            verify_dir_allows_lock_publication(dir)?;
            return Ok(UnixDirLock {
                key,
                cleanup: Some((dir_fd, UNIX_DIR_LOCK_NAME.to_owned(), fd_id)),
                _fd: existing_fd,
                _secondary_fd: None,
            });
        }
    }

    fn open_unix_lock_fd(dir: &ContainedDir) -> Result<OwnedFd, ContainedFsError> {
        let dot = c".";
        // Open a fresh open file description for this directory so `flock`
        // serializes both distinct processes and distinct threads sharing one
        // `ContainedDir`.
        // SAFETY: `dir.fd` is an open directory descriptor and `dot` is valid.
        let raw = unsafe {
            libc::openat(
                dir.fd.as_raw_fd(),
                dot.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if raw >= 0 {
            // SAFETY: `raw` is a newly opened valid directory descriptor.
            return Ok(unsafe { OwnedFd::from_raw_fd(raw) });
        }
        let error = io::Error::last_os_error();
        #[cfg(any(
            target_os = "macos",
            target_os = "ios",
            target_os = "freebsd",
            target_os = "netbsd"
        ))]
        if error.raw_os_error() == Some(libc::EACCES) {
            // On BSD/macOS, `O_SEARCH` allows locking execute-only (`0311`)
            // directories without directory-listing permission.
            // SAFETY: `dir.fd` is open and `dot` is valid.
            let search_raw =
                unsafe { libc::openat(dir.fd.as_raw_fd(), dot.as_ptr(), DIR_TRAVERSAL_FLAGS) };
            if search_raw >= 0 {
                // SAFETY: `search_raw` is a newly opened valid directory descriptor.
                return Ok(unsafe { OwnedFd::from_raw_fd(search_raw) });
            }
            return Err(ContainedFsError::Io(io::Error::last_os_error()));
        }
        Err(ContainedFsError::Io(error))
    }

    fn open_readable_self(dir: &ContainedDir) -> Option<OwnedFd> {
        let dot = c".";
        // SAFETY: `dir.fd` is an open directory descriptor and `dot` is valid.
        let raw = unsafe {
            libc::openat(
                dir.fd.as_raw_fd(),
                dot.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
            )
        };
        if raw < 0 {
            None
        } else {
            // SAFETY: `raw` is a newly opened valid file descriptor.
            Some(unsafe { OwnedFd::from_raw_fd(raw) })
        }
    }

    fn detect_unix_dir_filename_equivalence(dir: &ContainedDir) -> Option<DirFilenameEquivalence> {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            // SAFETY: `dir.fd` is an open directory descriptor.
            let mut value =
                unsafe { libc::fpathconf(dir.fd.as_raw_fd(), libc::_PC_CASE_SENSITIVE) };
            let mut readable_fd = None;
            if value < 0 && io::Error::last_os_error().raw_os_error() == Some(libc::EBADF) {
                readable_fd = open_readable_self(dir);
                if let Some(ref readable) = readable_fd {
                    // SAFETY: `readable` is an open directory descriptor.
                    value =
                        unsafe { libc::fpathconf(readable.as_raw_fd(), libc::_PC_CASE_SENSITIVE) };
                }
            }
            let case_insensitive = if value > 0 {
                Some(false)
            } else if value == 0 {
                Some(true)
            } else {
                let readable = readable_fd.as_ref().or(None);
                if let Some(readable) = readable {
                    probe_directory_case_insensitivity(dir, readable.as_raw_fd())
                } else {
                    open_readable_self(dir)
                        .and_then(|r| probe_directory_case_insensitivity(dir, r.as_raw_fd()))
                }
            }?;

            let mut fs_stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
            // SAFETY: `dir.fd` is an open directory descriptor and `fs_stat` is writable.
            let mut rc = unsafe { libc::fstatfs(dir.fd.as_raw_fd(), fs_stat.as_mut_ptr()) };
            if rc != 0 && io::Error::last_os_error().raw_os_error() == Some(libc::EBADF) {
                if readable_fd.is_none() {
                    readable_fd = open_readable_self(dir);
                }
                if let Some(ref readable) = readable_fd {
                    // SAFETY: `readable` is an open directory descriptor and `fs_stat` is writable.
                    rc = unsafe { libc::fstatfs(readable.as_raw_fd(), fs_stat.as_mut_ptr()) };
                }
            }
            enum AppleFsKind {
                Apfs,
                HfsPlus,
                Other,
            }
            let fs_kind = if rc == 0 {
                // SAFETY: `fstatfs` succeeded and initialized `fs_stat`.
                let fs_stat = unsafe { fs_stat.assume_init() };
                // SAFETY: `f_fstypename` is a NUL-terminated ASCII C string in `statfs`.
                let fs_type = unsafe { std::ffi::CStr::from_ptr(fs_stat.f_fstypename.as_ptr()) };
                if fs_type == c"apfs" {
                    AppleFsKind::Apfs
                } else if fs_type == c"hfs" {
                    AppleFsKind::HfsPlus
                } else {
                    AppleFsKind::Other
                }
            } else {
                AppleFsKind::Other
            };
            match (case_insensitive, fs_kind) {
                (true, AppleFsKind::Apfs) => {
                    Some(DirFilenameEquivalence::CaseInsensitiveUnicodeNfd)
                }
                (false, AppleFsKind::Apfs) => Some(DirFilenameEquivalence::UnicodeNfd),
                (true, AppleFsKind::HfsPlus) => {
                    Some(DirFilenameEquivalence::CaseInsensitiveHfsPlus)
                }
                (false, AppleFsKind::HfsPlus) => Some(DirFilenameEquivalence::UnicodeHfsPlus),
                // Non-local / unrecognized macOS mounts (SMB, NFS, FUSE, etc.)
                // can have server-defined normalization and case rules that
                // `f_fstypename` does not capture; leave them unknown so
                // callers probe the live mounted directory.
                (_, AppleFsKind::Other) => None,
            }
        }
        #[cfg(target_os = "linux")]
        {
            let readable = open_readable_self(dir)?;
            let mut checked_casefold_flag = false;
            const FS_CASEFOLD_FL: libc::c_int = 0x4000_0000;
            let mut flags: libc::c_int = 0;
            // SAFETY: `FS_IOC_GETFLAGS` writes a 32-bit `int` flag bitmask.
            if unsafe { libc::ioctl(readable.as_raw_fd(), libc::FS_IOC_GETFLAGS, &mut flags) } == 0
            {
                checked_casefold_flag = true;
                if (flags & FS_CASEFOLD_FL) != 0 {
                    // Linux ext4/f2fs/tmpfs casefold uses NFDICF (strips default-ignorables).
                    return Some(DirFilenameEquivalence::CaseInsensitiveUnicodeNfdicf);
                }
            }
            // Short-circuit only filesystems whose case semantics are fixed by
            // type (or strictly governed by `FS_CASEFOLD_FL` above); leave
            // configurable filesystems (CIFS/SMB, XFS, NTFS/NTFS3, OverlayFS,
            // FUSE, NFS, etc.) to `probe_directory_case_insensitivity`.
            let mut fs_stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
            // SAFETY: `readable` is open and `fs_stat` is writable.
            if unsafe { libc::fstatfs(readable.as_raw_fd(), fs_stat.as_mut_ptr()) } == 0 {
                // SAFETY: `fstatfs` succeeded and initialized `fs_stat`.
                let fs_stat = unsafe { fs_stat.assume_init() };
                #[allow(
                    clippy::cast_possible_truncation,
                    clippy::cast_sign_loss,
                    clippy::unnecessary_cast
                )]
                let f_type = fs_stat.f_type as u32;
                if let Some(equivalence) =
                    super::classify_linux_fs_magic(f_type, checked_casefold_flag)
                {
                    return Some(equivalence);
                }
            }
            // Keep `filename_equivalence` strictly read-only: return `None`
            // for unrecognized or configurable mounts (OverlayFS, SMB, FUSE,
            // NFS, XFS, etc.) so callers that are permitted to write can opt
            // into explicit live probing while read-only previews never mutate
            // directory timestamps or emit filesystem events.
            None
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "linux")))]
        {
            let _ = dir;
            None
        }
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
        c_target: &std::ffi::CStr,
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
        #[cfg(any(target_os = "macos", target_os = "ios"))]
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
                if matches!(
                    error.raw_os_error(),
                    Some(libc::ENODATA | libc::EOPNOTSUPP | libc::ENOSYS)
                ) {
                    return Ok(None);
                }
                return Err(error);
            }
            if size == 0 {
                return Ok(Some(Vec::new()));
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
    fn strip_inherited_acl(
        temp_fd: std::os::fd::RawFd,
        preserve_default_acl: bool,
    ) -> io::Result<()> {
        remove_linux_xattr_if_present(temp_fd, c"system.posix_acl_access")?;
        if !preserve_default_acl {
            remove_linux_xattr_if_present(temp_fd, c"system.posix_acl_default")?;
        }
        remove_linux_xattr_if_present(temp_fd, c"system.nfs4_acl")?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn read_linux_dir_xattr(
        dir: &ContainedDir,
        name: &std::ffi::CStr,
    ) -> io::Result<Option<Vec<u8>>> {
        if let Some(readable) = open_readable_self(dir) {
            return read_linux_xattr(readable.as_raw_fd(), name);
        }
        let proc_fd = CString::new(format!("/proc/self/fd/{}", dir.fd.as_raw_fd()))
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid procfs fd path"))?;
        for _ in 0..4 {
            // SAFETY: querying xattr size on pinned procfs descriptor path.
            let size =
                unsafe { libc::getxattr(proc_fd.as_ptr(), name.as_ptr(), std::ptr::null_mut(), 0) };
            if size < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.raw_os_error(),
                    Some(libc::ENODATA | libc::EOPNOTSUPP | libc::ENOSYS)
                ) {
                    return Ok(None);
                }
                return Err(error);
            }
            if size == 0 {
                return Ok(Some(Vec::new()));
            }
            let mut buffer = vec![0u8; usize::try_from(size).unwrap_or(0)];
            // SAFETY: `buffer` has `buffer.len()` writable bytes.
            let read = unsafe {
                libc::getxattr(
                    proc_fd.as_ptr(),
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
            "extended attribute size changed repeatedly while reading directory ACL",
        ))
    }

    #[cfg(target_os = "linux")]
    fn parent_has_foreign_write_acl(parent_dir: &ContainedDir) -> io::Result<bool> {
        // For POSIX.1e ACLs, `(st_mode & 0o0022) == 0` already guarantees that
        // `ACL_MASK` and `ACL_OTHER` have no write bit. For NFSv4 ACLs, treat
        // any attached `system.nfs4_acl` conservatively as potentially writable.
        Ok(read_linux_dir_xattr(parent_dir, c"system.nfs4_acl")?.is_some())
    }

    #[cfg(target_os = "linux")]
    fn read_inherited_new_file_acl(parent_dir: &ContainedDir) -> io::Result<Option<ExistingAcl>> {
        // When `O_TMPFILE` is unavailable and staged creation is used,
        // `system.posix_acl_default` is preserved on the staging directory,
        // while `system.nfs4_acl` is stripped for staging privacy. Fail closed
        // if the destination parent has a Linux NFSv4 ACL whose inheritable
        // rules cannot be reproduced by staged creation.
        if read_linux_dir_xattr(parent_dir, c"system.nfs4_acl")?.is_some() {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "cannot safely preserve Linux NFSv4 ACL inheritance during staged atomic creation without O_TMPFILE",
            ));
        }
        Ok(None)
    }

    #[cfg(target_os = "linux")]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        Ok(left == right)
    }

    #[cfg(target_os = "linux")]
    fn read_linux_security_xattrs(fd: std::os::fd::RawFd) -> io::Result<Vec<(CString, Vec<u8>)>> {
        let mut attrs = std::collections::BTreeMap::<CString, Vec<u8>>::new();
        // Probe well-known LSM access-control labels explicitly so synthesized
        // SELinux or Smack attributes are captured even if `flistxattr` omits them.
        for known in [
            c"security.selinux",
            c"security.SMACK64",
            c"security.SMACK64EXEC",
            c"security.SMACK64MMAP",
        ] {
            if let Some(value) = read_linux_xattr(fd, known)? {
                attrs.insert(known.to_owned(), value);
            }
        }
        // Also enumerate any additional `security.*` extended attributes on the
        // inode (such as Smack transmute/custom labels or capabilities).
        let mut names_buf = Vec::new();
        let mut listed = false;
        for _ in 0..4 {
            // SAFETY: querying list size with null buffer.
            let size = unsafe { libc::flistxattr(fd, std::ptr::null_mut(), 0) };
            if size < 0 {
                let error = io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::ENOSYS)) {
                    listed = true;
                    break;
                }
                return Err(error);
            }
            if size == 0 {
                listed = true;
                break;
            }
            names_buf.resize(usize::try_from(size).unwrap_or(0), 0u8);
            // SAFETY: `names_buf` has `names_buf.len()` writable bytes.
            let read = unsafe {
                libc::flistxattr(
                    fd,
                    names_buf.as_mut_ptr().cast::<libc::c_char>(),
                    names_buf.len(),
                )
            };
            if read >= 0 {
                names_buf.truncate(usize::try_from(read).unwrap_or(0));
                listed = true;
                break;
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ERANGE) {
                continue;
            }
            if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::ENOSYS)) {
                names_buf.clear();
                listed = true;
                break;
            }
            return Err(error);
        }
        if !listed {
            return Err(io::Error::other(
                "extended attribute list changed concurrently while reading Linux security labels",
            ));
        }
        for raw_name in names_buf.split(|&byte| byte == 0) {
            if !raw_name.starts_with(b"security.") {
                continue;
            }
            let Ok(c_name) = CString::new(raw_name) else {
                continue;
            };
            match super::classify_linux_security_xattr(raw_name) {
                super::LinuxSecurityXattrKind::CopyableAccessLabel => {
                    if attrs.contains_key(&c_name) {
                        continue;
                    }
                    if let Some(value) = read_linux_xattr(fd, &c_name)? {
                        attrs.insert(c_name, value);
                    }
                }
                super::LinuxSecurityXattrKind::UnpreservableIntegrityOrUnknown => {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        format!(
                            "cannot safely preserve Linux integrity or unrecognized security attribute {} across atomic replacement",
                            c_name.to_string_lossy()
                        ),
                    ));
                }
            }
        }
        Ok(attrs.into_iter().collect())
    }

    #[cfg(target_os = "linux")]
    fn read_existing_acl(fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        let posix_access = read_linux_xattr(fd, c"system.posix_acl_access")?;
        let nfs4 = read_linux_xattr(fd, c"system.nfs4_acl")?;
        let security_xattrs = read_linux_security_xattrs(fd)?;
        if posix_access.is_none() && nfs4.is_none() && security_xattrs.is_empty() {
            Ok(None)
        } else {
            Ok(Some(ExistingAcl {
                posix_access,
                nfs4,
                security_xattrs,
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
        for (name, expected_value) in &acl.security_xattrs {
            let current_value = read_linux_xattr(temp_fd, name)?;
            if current_value.as_deref() != Some(expected_value.as_slice()) {
                // SAFETY: `temp_fd` is open and `expected_value` is a valid buffer.
                if unsafe {
                    libc::fsetxattr(
                        temp_fd,
                        name.as_ptr(),
                        expected_value.as_ptr().cast::<libc::c_void>(),
                        expected_value.len(),
                        0,
                    )
                } != 0
                {
                    let error = io::Error::last_os_error();
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        format!(
                            "cannot preserve Linux security label {} on replacement: {error}",
                            name.to_string_lossy()
                        ),
                    ));
                }
            }
        }
        if !acl.security_xattrs.is_empty() {
            let verified = read_linux_security_xattrs(temp_fd)?;
            if verified != acl.security_xattrs {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "cannot verify Linux security label preservation on replacement",
                ));
            }
        }
        Ok(())
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
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

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        match (left, right) {
            (None, None) => Ok(true),
            (Some(a), Some(b)) => Ok(serialize_macos_acl(a)? == serialize_macos_acl(b)?),
            _ => Ok(false),
        }
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn strip_inherited_acl(
        temp_fd: std::os::fd::RawFd,
        _preserve_default_acl: bool,
    ) -> io::Result<()> {
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

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn parent_has_foreign_write_acl(parent_dir: &ContainedDir) -> io::Result<bool> {
        // SAFETY: `parent_dir.fd` is an open directory descriptor.
        let mut raw = unsafe {
            macos_acl::acl_get_fd_np(parent_dir.fd.as_raw_fd(), macos_acl::ACL_TYPE_EXTENDED)
        };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EBADF)
                && let Some(readable) = open_readable_self(parent_dir)
            {
                // SAFETY: `readable` is an open directory descriptor.
                raw = unsafe {
                    macos_acl::acl_get_fd_np(readable.as_raw_fd(), macos_acl::ACL_TYPE_EXTENDED)
                };
            } else if matches!(
                error.raw_os_error(),
                Some(libc::ENOENT | libc::ENOTSUP | libc::EOPNOTSUPP | libc::EINVAL)
            ) {
                return Ok(false);
            } else {
                return Err(error);
            }
        }
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if matches!(
                error.raw_os_error(),
                Some(libc::ENOENT | libc::ENOTSUP | libc::EOPNOTSUPP | libc::EINVAL)
            ) {
                return Ok(false);
            }
            return Err(error);
        }
        let parent_acl = ExistingAcl(raw);
        // SAFETY: `geteuid` has no preconditions.
        let euid = unsafe { libc::geteuid() };
        let resolve_uid_uuid = |uid: libc::uid_t| -> Option<[u8; 16]> {
            let mut uuid = [0_u8; 16];
            // SAFETY: `uuid` is 16 writable bytes for `mbr_uid_to_uuid`.
            if unsafe { macos_acl::mbr_uid_to_uuid(uid, uuid.as_mut_ptr()) } == 0 {
                Some(uuid)
            } else {
                None
            }
        };
        let euid_uuid = resolve_uid_uuid(euid);
        let root_uuid = resolve_uid_uuid(0);

        let mut entry_id = macos_acl::ACL_FIRST_ENTRY;
        let mut entry: *mut libc::c_void = std::ptr::null_mut();
        loop {
            // SAFETY: `parent_acl.0` is a valid `acl_t`.
            if unsafe { macos_acl::acl_get_entry(parent_acl.0, entry_id, &mut entry) } != 0 {
                return Ok(false);
            }
            entry_id = macos_acl::ACL_NEXT_ENTRY;
            let mut tag_type: libc::c_int = 0;
            // SAFETY: `entry` is a valid `acl_entry_t`.
            if unsafe { macos_acl::acl_get_tag_type(entry, &mut tag_type) } != 0 {
                return Err(io::Error::last_os_error());
            }
            if tag_type != macos_acl::ACL_EXTENDED_ALLOW {
                continue;
            }
            let mut flags: *mut libc::c_void = std::ptr::null_mut();
            // SAFETY: `entry` is a valid `acl_entry_t`.
            if unsafe { macos_acl::acl_get_flagset_np(entry, &mut flags) } != 0 {
                return Err(io::Error::last_os_error());
            }
            // `ONLY_INHERIT` entries do not grant any rights on the parent directory itself.
            // SAFETY: `flags` is a valid `acl_flagset_t`.
            if unsafe { macos_acl::acl_get_flag_np(flags, macos_acl::ACL_ENTRY_ONLY_INHERIT) } == 1
            {
                continue;
            }
            let mut permset: *mut libc::c_void = std::ptr::null_mut();
            // SAFETY: `entry` is a valid `acl_entry_t`.
            if unsafe { macos_acl::acl_get_permset(entry, &mut permset) } != 0 {
                return Err(io::Error::last_os_error());
            }
            let mut grants_write = false;
            for write_perm in [
                macos_acl::ACL_ADD_FILE,
                macos_acl::ACL_DELETE,
                macos_acl::ACL_ADD_SUBDIRECTORY,
                macos_acl::ACL_DELETE_CHILD,
                macos_acl::ACL_WRITE_ATTRIBUTES,
                macos_acl::ACL_WRITE_EXTATTRIBUTES,
                macos_acl::ACL_WRITE_SECURITY,
                macos_acl::ACL_CHANGE_OWNER,
            ] {
                // SAFETY: `permset` is a valid `acl_permset_t`.
                if unsafe { macos_acl::acl_get_perm_np(permset, write_perm) } == 1 {
                    grants_write = true;
                    break;
                }
            }
            if !grants_write {
                continue;
            }
            // Check which principal receives the write grant; caller-only (or
            // root-only) entries are safe, while any other user/group or
            // unresolved principal fails closed.
            // SAFETY: `entry` is a valid `acl_entry_t`.
            let qual = unsafe { macos_acl::acl_get_qualifier(entry) };
            if qual.is_null() {
                return Ok(true);
            }
            // SAFETY: macOS extended ACL qualifiers are 16-byte `guid_t` UUIDs.
            let entry_uuid = unsafe { *qual.cast::<[u8; 16]>() };
            // SAFETY: `qual` was allocated by `acl_get_qualifier` and must be freed via `acl_free`.
            unsafe {
                let _ = macos_acl::acl_free(qual);
            }
            if euid_uuid.is_some_and(|uuid| uuid == entry_uuid)
                || root_uuid.is_some_and(|uuid| uuid == entry_uuid)
            {
                continue;
            }
            return Ok(true);
        }
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn read_inherited_new_file_acl(parent_dir: &ContainedDir) -> io::Result<Option<ExistingAcl>> {
        // SAFETY: `parent_dir.fd` is an open directory descriptor.
        let mut raw = unsafe {
            macos_acl::acl_get_fd_np(parent_dir.fd.as_raw_fd(), macos_acl::ACL_TYPE_EXTENDED)
        };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EBADF)
                && let Some(readable) = open_readable_self(parent_dir)
            {
                // SAFETY: `readable` is an open directory descriptor.
                raw = unsafe {
                    macos_acl::acl_get_fd_np(readable.as_raw_fd(), macos_acl::ACL_TYPE_EXTENDED)
                };
            } else if matches!(
                error.raw_os_error(),
                Some(libc::ENOENT | libc::ENOTSUP | libc::EOPNOTSUPP | libc::EINVAL)
            ) {
                return Ok(None);
            } else {
                return Err(error);
            }
        }
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
        let parent_acl = ExistingAcl(raw);
        // SAFETY: initializing an empty macOS extended ACL.
        let dest_raw = unsafe { macos_acl::acl_init(0) };
        if dest_raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let mut inherited = ExistingAcl(dest_raw);
        let mut has_entries = false;
        let mut entry_id = macos_acl::ACL_FIRST_ENTRY;
        let mut src_entry: *mut libc::c_void = std::ptr::null_mut();
        loop {
            // SAFETY: `parent_acl.0` is a valid `acl_t`.
            if unsafe { macos_acl::acl_get_entry(parent_acl.0, entry_id, &mut src_entry) } != 0 {
                break;
            }
            entry_id = macos_acl::ACL_NEXT_ENTRY;
            let mut src_flags: *mut libc::c_void = std::ptr::null_mut();
            // SAFETY: `src_entry` is a valid `acl_entry_t`.
            if unsafe { macos_acl::acl_get_flagset_np(src_entry, &mut src_flags) } != 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: `src_flags` is a valid `acl_flagset_t`.
            if unsafe { macos_acl::acl_get_flag_np(src_flags, macos_acl::ACL_ENTRY_FILE_INHERIT) }
                != 1
            {
                continue;
            }
            let mut dest_entry: *mut libc::c_void = std::ptr::null_mut();
            // SAFETY: `&mut inherited.0` is a valid `acl_t` pointer that `acl_create_entry` may reallocate.
            if unsafe { macos_acl::acl_create_entry(&mut inherited.0, &mut dest_entry) } != 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: both `dest_entry` and `src_entry` are valid `acl_entry_t` handles.
            if unsafe { macos_acl::acl_copy_entry(dest_entry, src_entry) } != 0 {
                return Err(io::Error::last_os_error());
            }
            let mut dest_flags: *mut libc::c_void = std::ptr::null_mut();
            // SAFETY: `dest_entry` is a valid `acl_entry_t`.
            if unsafe { macos_acl::acl_get_flagset_np(dest_entry, &mut dest_flags) } != 0 {
                return Err(io::Error::last_os_error());
            }
            for clear_flag in [
                macos_acl::ACL_ENTRY_FILE_INHERIT,
                macos_acl::ACL_ENTRY_DIRECTORY_INHERIT,
                macos_acl::ACL_ENTRY_LIMIT_INHERIT,
                macos_acl::ACL_ENTRY_ONLY_INHERIT,
            ] {
                // SAFETY: `dest_flags` is a valid `acl_flagset_t`.
                if unsafe { macos_acl::acl_delete_flag_np(dest_flags, clear_flag) } != 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            // SAFETY: `dest_flags` is a valid `acl_flagset_t`.
            if unsafe { macos_acl::acl_add_flag_np(dest_flags, macos_acl::ACL_ENTRY_INHERITED) }
                != 0
            {
                return Err(io::Error::last_os_error());
            }
            has_entries = true;
        }
        if has_entries {
            Ok(Some(inherited))
        } else {
            Ok(None)
        }
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
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

    #[cfg(any(target_os = "macos", target_os = "ios"))]
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
    fn strip_inherited_acl(
        temp_fd: std::os::fd::RawFd,
        _preserve_default_acl: bool,
    ) -> io::Result<()> {
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

    #[cfg(target_os = "freebsd")]
    fn parent_has_foreign_write_acl(parent_dir: &ContainedDir) -> io::Result<bool> {
        // For POSIX.1e ACLs, `(st_mode & 0o0022) == 0` guarantees `ACL_MASK` and
        // `ACL_OTHER` have no write bit. For FreeBSD NFSv4 ACLs, any non-trivial
        // ACL may grant directory modification rights to another principal.
        // SAFETY: `parent_dir.fd` is an open directory descriptor.
        let mut raw = unsafe {
            freebsd_acl::acl_get_fd_np(parent_dir.fd.as_raw_fd(), freebsd_acl::ACL_TYPE_NFS4)
        };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EBADF)
                && let Some(readable) = open_readable_self(parent_dir)
            {
                // SAFETY: `readable` is an open directory descriptor.
                raw = unsafe {
                    freebsd_acl::acl_get_fd_np(readable.as_raw_fd(), freebsd_acl::ACL_TYPE_NFS4)
                };
            } else if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::EINVAL)) {
                return Ok(false);
            } else {
                return Err(error);
            }
        }
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::EINVAL)) {
                return Ok(false);
            }
            return Err(error);
        }
        let parent_acl = ExistingAcl {
            acl_type: freebsd_acl::ACL_TYPE_NFS4,
            ptr: raw,
        };
        let mut trivial: libc::c_int = 0;
        // SAFETY: `parent_acl.ptr` is a valid FreeBSD `acl_t`.
        if unsafe { freebsd_acl::acl_is_trivial_np(parent_acl.ptr, &mut trivial) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(trivial == 0)
    }

    #[cfg(target_os = "freebsd")]
    fn read_inherited_new_file_acl(parent_dir: &ContainedDir) -> io::Result<Option<ExistingAcl>> {
        // POSIX `ACL_TYPE_DEFAULT` is preserved on the staging directory. For
        // FreeBSD NFSv4 ACLs, check whether the destination parent has any
        // non-trivial `file_inherit` ACE and fail closed rather than publishing
        // a file missing its inherited access controls.
        // SAFETY: `parent_dir.fd` is an open directory descriptor.
        let mut raw = unsafe {
            freebsd_acl::acl_get_fd_np(parent_dir.fd.as_raw_fd(), freebsd_acl::ACL_TYPE_NFS4)
        };
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EBADF)
                && let Some(readable) = open_readable_self(parent_dir)
            {
                // SAFETY: `readable` is an open directory descriptor.
                raw = unsafe {
                    freebsd_acl::acl_get_fd_np(readable.as_raw_fd(), freebsd_acl::ACL_TYPE_NFS4)
                };
            } else if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::EINVAL)) {
                return Ok(None);
            } else {
                return Err(error);
            }
        }
        if raw.is_null() {
            let error = io::Error::last_os_error();
            if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::EINVAL)) {
                return Ok(None);
            }
            return Err(error);
        }
        let parent_acl = ExistingAcl {
            acl_type: freebsd_acl::ACL_TYPE_NFS4,
            ptr: raw,
        };
        let mut trivial: libc::c_int = 0;
        // SAFETY: `parent_acl.ptr` is a valid FreeBSD `acl_t`.
        if unsafe { freebsd_acl::acl_is_trivial_np(parent_acl.ptr, &mut trivial) } != 0 {
            return Err(io::Error::last_os_error());
        }
        if trivial != 0 {
            return Ok(None);
        }
        let mut entry_id = freebsd_acl::ACL_FIRST_ENTRY;
        let mut entry: *mut libc::c_void = std::ptr::null_mut();
        loop {
            // SAFETY: `parent_acl.ptr` is a valid FreeBSD `acl_t`.
            let rc = unsafe { freebsd_acl::acl_get_entry(parent_acl.ptr, entry_id, &mut entry) };
            if rc == 0 {
                return Ok(None);
            }
            if rc < 0 {
                return Err(io::Error::last_os_error());
            }
            entry_id = freebsd_acl::ACL_NEXT_ENTRY;
            let mut flagset: *mut libc::c_void = std::ptr::null_mut();
            // SAFETY: `entry` is a valid FreeBSD `acl_entry_t`.
            if unsafe { freebsd_acl::acl_get_flagset_np(entry, &mut flagset) } != 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: `flagset` is a valid FreeBSD `acl_flagset_t`.
            if unsafe { freebsd_acl::acl_get_flag_np(flagset, freebsd_acl::ACL_ENTRY_FILE_INHERIT) }
                == 1
            {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "cannot safely preserve inheritable FreeBSD NFSv4 ACLs during staged atomic file creation",
                ));
            }
        }
    }

    #[cfg(target_os = "netbsd")]
    fn netbsd_fd_supports_acls(fd: std::os::fd::RawFd) -> io::Result<bool> {
        // NetBSD `_PC_ACL_NFS4` (16 in `<sys/unistd.h>`) complements
        // `libc::_PC_ACL_EXTENDED` (14).
        const PC_ACL_NFS4: libc::c_int = 16;
        for name in [libc::_PC_ACL_EXTENDED, PC_ACL_NFS4] {
            // SAFETY: `fd` is an open file descriptor.
            let val = unsafe { libc::fpathconf(fd, name) };
            if val > 0 {
                return Ok(true);
            }
            if val < 0 {
                let error = io::Error::last_os_error();
                if !matches!(
                    error.raw_os_error(),
                    Some(libc::EINVAL | libc::EOPNOTSUPP | libc::ENOTSUP)
                ) {
                    return Err(error);
                }
            }
        }
        Ok(false)
    }

    #[cfg(target_os = "netbsd")]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        Ok(left.is_none() && right.is_none())
    }

    #[cfg(target_os = "netbsd")]
    fn strip_inherited_acl(
        temp_fd: std::os::fd::RawFd,
        _preserve_default_acl: bool,
    ) -> io::Result<()> {
        if netbsd_fd_supports_acls(temp_fd)? {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "cannot verify or clear inherited filesystem ACLs on an ACL-enabled NetBSD mount",
            ));
        }
        Ok(())
    }

    #[cfg(target_os = "netbsd")]
    fn parent_has_foreign_write_acl(parent_dir: &ContainedDir) -> io::Result<bool> {
        netbsd_fd_supports_acls(parent_dir.fd.as_raw_fd())
    }

    #[cfg(target_os = "netbsd")]
    fn read_inherited_new_file_acl(parent_dir: &ContainedDir) -> io::Result<Option<ExistingAcl>> {
        if netbsd_fd_supports_acls(parent_dir.fd.as_raw_fd())? {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "cannot verify or preserve inherited filesystem ACLs on an ACL-enabled NetBSD mount",
            ));
        }
        Ok(None)
    }

    #[cfg(target_os = "netbsd")]
    fn read_existing_acl(fd: std::os::fd::RawFd) -> io::Result<Option<ExistingAcl>> {
        if netbsd_fd_supports_acls(fd)? {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "cannot verify or preserve filesystem ACLs on an ACL-enabled NetBSD mount",
            ));
        }
        Ok(None)
    }

    #[cfg(target_os = "netbsd")]
    fn apply_existing_acl(_temp_fd: std::os::fd::RawFd, _acl: &ExistingAcl) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot preserve filesystem ACLs on NetBSD",
        ))
    }

    #[cfg(target_os = "openbsd")]
    fn acl_equals(_left: Option<&ExistingAcl>, _right: Option<&ExistingAcl>) -> io::Result<bool> {
        Ok(true)
    }

    #[cfg(target_os = "openbsd")]
    fn strip_inherited_acl(
        _temp_fd: std::os::fd::RawFd,
        _preserve_default_acl: bool,
    ) -> io::Result<()> {
        Ok(())
    }

    #[cfg(target_os = "openbsd")]
    fn parent_has_foreign_write_acl(_parent_dir: &ContainedDir) -> io::Result<bool> {
        Ok(false)
    }

    #[cfg(target_os = "openbsd")]
    fn read_inherited_new_file_acl(_parent_dir: &ContainedDir) -> io::Result<Option<ExistingAcl>> {
        Ok(None)
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
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn acl_equals(left: Option<&ExistingAcl>, right: Option<&ExistingAcl>) -> io::Result<bool> {
        Ok(left.is_none() && right.is_none())
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn strip_inherited_acl(
        _temp_fd: std::os::fd::RawFd,
        _preserve_default_acl: bool,
    ) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot verify or clear inherited filesystem ACLs on this Unix target",
        ))
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn parent_has_foreign_write_acl(_parent_dir: &ContainedDir) -> io::Result<bool> {
        // Conservatively require a sticky parent when ACLs cannot be inspected.
        Ok(true)
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn read_inherited_new_file_acl(_parent_dir: &ContainedDir) -> io::Result<Option<ExistingAcl>> {
        Ok(None)
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd",
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
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn apply_existing_acl(_temp_fd: std::os::fd::RawFd, _acl: &ExistingAcl) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot preserve filesystem ACLs on this Unix target",
        ))
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn is_macos_kernel_managed_xattr(name: &[u8]) -> bool {
        name.starts_with(b"com.apple.acl.")
            || matches!(
                name,
                b"com.apple.decmpfs"
                    | b"com.apple.macl"
                    | b"com.apple.provenance"
                    | b"com.apple.rootless"
                    | b"com.apple.system.Security"
            )
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn read_existing_user_xattrs(fd: std::os::fd::RawFd) -> io::Result<Vec<(CString, Vec<u8>)>> {
        let mut names_buf = Vec::new();
        let mut listed = false;
        for _ in 0..4 {
            // SAFETY: querying list size with null buffer.
            let size = unsafe { libc::flistxattr(fd, std::ptr::null_mut(), 0, 0) };
            if size < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.raw_os_error(),
                    Some(libc::ENOTSUP | libc::EOPNOTSUPP | libc::ENOSYS)
                ) {
                    return Ok(Vec::new());
                }
                return Err(error);
            }
            if size == 0 {
                return Ok(Vec::new());
            }
            names_buf.resize(usize::try_from(size).unwrap_or(0), 0u8);
            // SAFETY: `names_buf` has `names_buf.len()` writable bytes.
            let read = unsafe {
                libc::flistxattr(
                    fd,
                    names_buf.as_mut_ptr().cast::<libc::c_char>(),
                    names_buf.len(),
                    0,
                )
            };
            if read >= 0 {
                names_buf.truncate(usize::try_from(read).unwrap_or(0));
                listed = true;
                break;
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ERANGE) {
                continue;
            }
            if matches!(
                error.raw_os_error(),
                Some(libc::ENOTSUP | libc::EOPNOTSUPP | libc::ENOSYS)
            ) {
                return Ok(Vec::new());
            }
            return Err(error);
        }
        if !listed {
            return Err(io::Error::other(
                "extended attribute list changed concurrently during destination snapshot",
            ));
        }

        let mut xattrs = Vec::new();
        for raw_name in names_buf.split(|&byte| byte == 0) {
            if raw_name.is_empty() || is_macos_kernel_managed_xattr(raw_name) {
                continue;
            }
            let Ok(c_name) = CString::new(raw_name) else {
                continue;
            };
            let mut outcome: Option<Option<Vec<u8>>> = None;
            for _ in 0..4 {
                // SAFETY: querying xattr size with null buffer.
                let size =
                    unsafe { libc::fgetxattr(fd, c_name.as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
                if size < 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::ENOATTR) {
                        outcome = Some(None);
                        break;
                    }
                    return Err(error);
                }
                let mut value = vec![0u8; usize::try_from(size).unwrap_or(0)];
                if value.is_empty() {
                    outcome = Some(Some(value));
                    break;
                }
                // SAFETY: `value` has `value.len()` writable bytes.
                let read = unsafe {
                    libc::fgetxattr(
                        fd,
                        c_name.as_ptr(),
                        value.as_mut_ptr().cast::<libc::c_void>(),
                        value.len(),
                        0,
                        0,
                    )
                };
                if read >= 0 {
                    value.truncate(usize::try_from(read).unwrap_or(0));
                    outcome = Some(Some(value));
                    break;
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ERANGE) {
                    continue;
                }
                if error.raw_os_error() == Some(libc::ENOATTR) {
                    outcome = Some(None);
                    break;
                }
                return Err(error);
            }
            match outcome {
                Some(Some(value)) => xattrs.push((c_name, value)),
                Some(None) => {}
                None => {
                    return Err(io::Error::other(
                        "extended attribute value changed concurrently during destination snapshot",
                    ));
                }
            }
        }
        xattrs.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
        Ok(xattrs)
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    fn apply_existing_user_xattrs(
        temp_fd: std::os::fd::RawFd,
        xattrs: &[(CString, Vec<u8>)],
    ) -> io::Result<()> {
        for (name, value) in xattrs {
            // SAFETY: `temp_fd` is open, `name` is NUL-terminated, and
            // `value.as_ptr()` is valid for `value.len()` bytes (non-null even when empty).
            let rc = unsafe {
                libc::fsetxattr(
                    temp_fd,
                    name.as_ptr(),
                    value.as_ptr().cast::<libc::c_void>(),
                    value.len(),
                    0,
                    0,
                )
            };
            if rc != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn read_existing_user_xattrs(fd: std::os::fd::RawFd) -> io::Result<Vec<(CString, Vec<u8>)>> {
        let mut names_buf = Vec::new();
        let mut listed = false;
        for _ in 0..4 {
            // SAFETY: querying list size with null buffer.
            let size = unsafe { libc::flistxattr(fd, std::ptr::null_mut(), 0) };
            if size < 0 {
                let error = io::Error::last_os_error();
                if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::ENOSYS)) {
                    return Ok(Vec::new());
                }
                return Err(error);
            }
            if size == 0 {
                return Ok(Vec::new());
            }
            names_buf.resize(usize::try_from(size).unwrap_or(0), 0u8);
            // SAFETY: `names_buf` has `names_buf.len()` writable bytes.
            let read = unsafe {
                libc::flistxattr(
                    fd,
                    names_buf.as_mut_ptr().cast::<libc::c_char>(),
                    names_buf.len(),
                )
            };
            if read >= 0 {
                names_buf.truncate(usize::try_from(read).unwrap_or(0));
                listed = true;
                break;
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ERANGE) {
                continue;
            }
            if matches!(error.raw_os_error(), Some(libc::EOPNOTSUPP | libc::ENOSYS)) {
                return Ok(Vec::new());
            }
            return Err(error);
        }
        if !listed {
            return Err(io::Error::other(
                "extended attribute list changed concurrently during destination snapshot",
            ));
        }

        let mut xattrs = Vec::new();
        for raw_name in names_buf.split(|&byte| byte == 0) {
            match super::classify_linux_xattr_for_copy(raw_name) {
                super::LinuxCopyableXattrKind::Ignore => continue,
                super::LinuxCopyableXattrKind::UnpreservableTrusted => {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        format!(
                            "cannot safely preserve filesystem-internal trusted xattr {} across atomic replacement",
                            String::from_utf8_lossy(raw_name)
                        ),
                    ));
                }
                super::LinuxCopyableXattrKind::Copyable => {}
            }
            let Ok(c_name) = CString::new(raw_name) else {
                continue;
            };
            let mut outcome: Option<Option<Vec<u8>>> = None;
            for _ in 0..4 {
                // SAFETY: querying xattr size with null buffer.
                let size = unsafe { libc::fgetxattr(fd, c_name.as_ptr(), std::ptr::null_mut(), 0) };
                if size < 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::ENODATA) {
                        outcome = Some(None);
                        break;
                    }
                    return Err(error);
                }
                let mut value = vec![0u8; usize::try_from(size).unwrap_or(0)];
                if value.is_empty() {
                    outcome = Some(Some(value));
                    break;
                }
                // SAFETY: `value` has `value.len()` writable bytes.
                let read = unsafe {
                    libc::fgetxattr(
                        fd,
                        c_name.as_ptr(),
                        value.as_mut_ptr().cast::<libc::c_void>(),
                        value.len(),
                    )
                };
                if read >= 0 {
                    value.truncate(usize::try_from(read).unwrap_or(0));
                    outcome = Some(Some(value));
                    break;
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ERANGE) {
                    continue;
                }
                if error.raw_os_error() == Some(libc::ENODATA) {
                    outcome = Some(None);
                    break;
                }
                return Err(error);
            }
            match outcome {
                Some(Some(value)) => xattrs.push((c_name, value)),
                Some(None) => {}
                None => {
                    return Err(io::Error::other(
                        "extended attribute value changed concurrently during destination snapshot",
                    ));
                }
            }
        }
        xattrs.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
        Ok(xattrs)
    }

    #[cfg(target_os = "linux")]
    fn apply_existing_user_xattrs(
        temp_fd: std::os::fd::RawFd,
        xattrs: &[(CString, Vec<u8>)],
    ) -> io::Result<()> {
        for (name, value) in xattrs {
            // SAFETY: `temp_fd` is open, `name` is NUL-terminated, and
            // `value.as_ptr()` is valid for `value.len()` bytes (non-null even when empty).
            let rc = unsafe {
                libc::fsetxattr(
                    temp_fd,
                    name.as_ptr(),
                    value.as_ptr().cast::<libc::c_void>(),
                    value.len(),
                    0,
                )
            };
            if rc != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    const LINUX_USER_MODIFIABLE_INODE_FLAGS: libc::c_int = 0x0000_0001 // FS_SECRM_FL (s)
        | 0x0000_0002 // FS_UNRM_FL (u)
        | 0x0000_0004 // FS_COMPR_FL (c)
        | 0x0000_0008 // FS_SYNC_FL (S)
        | 0x0000_0010 // FS_IMMUTABLE_FL (i)
        | 0x0000_0020 // FS_APPEND_FL (a)
        | 0x0000_0040 // FS_NODUMP_FL (d)
        | 0x0000_0080 // FS_NOATIME_FL (A)
        | 0x0000_0400 // FS_NOCOMP_FL (m)
        | 0x0000_4000 // FS_JOURNAL_DATA_FL (j)
        | 0x0000_8000 // FS_NOTAIL_FL (t)
        | 0x0080_0000 // FS_NOCOW_FL (C)
        | 0x2000_0000; // FS_PROJINHERIT_FL (P)

    #[cfg(target_os = "linux")]
    const LINUX_PRE_WRITE_INODE_FLAGS: libc::c_int = 0x0000_0004 // FS_COMPR_FL (c)
        | 0x0000_0400 // FS_NOCOMP_FL (m)
        | 0x0080_0000; // FS_NOCOW_FL (C) — must be set on empty file on Btrfs

    #[cfg(target_os = "linux")]
    fn read_linux_inode_flags(fd: std::os::fd::RawFd) -> io::Result<Option<libc::c_int>> {
        let mut flags: libc::c_int = 0;
        // SAFETY: Linux `FS_IOC_GETFLAGS` writes a 32-bit `int` flag bitmask.
        if unsafe { libc::ioctl(fd, libc::FS_IOC_GETFLAGS, &mut flags) } == 0 {
            return Ok(Some(flags & LINUX_USER_MODIFIABLE_INODE_FLAGS));
        }
        let error = io::Error::last_os_error();
        if matches!(
            error.raw_os_error(),
            Some(libc::ENOTTY | libc::EOPNOTSUPP | libc::EINVAL | libc::ENOSYS)
        ) {
            return Ok(None);
        }
        Err(error)
    }

    #[cfg(target_os = "linux")]
    #[repr(C)]
    struct LinuxFsxattr {
        fsx_xflags: u32,
        fsx_extsize: u32,
        fsx_nextents: u32,
        fsx_projid: u32,
        fsx_cowextsize: u32,
        fsx_pad: [u8; 8],
    }

    #[cfg(all(
        target_os = "linux",
        any(
            target_arch = "powerpc",
            target_arch = "powerpc64",
            target_arch = "mips",
            target_arch = "mips64",
            target_arch = "sparc",
            target_arch = "sparc64"
        )
    ))]
    const FS_IOC_FSGETXATTR: libc::Ioctl = 0x401C_581F_u32 as libc::Ioctl;
    #[cfg(all(
        target_os = "linux",
        any(
            target_arch = "powerpc",
            target_arch = "powerpc64",
            target_arch = "mips",
            target_arch = "mips64",
            target_arch = "sparc",
            target_arch = "sparc64"
        )
    ))]
    const FS_IOC_FSSETXATTR: libc::Ioctl = 0x801C_5820_u32 as libc::Ioctl;

    #[cfg(all(
        target_os = "linux",
        not(any(
            target_arch = "powerpc",
            target_arch = "powerpc64",
            target_arch = "mips",
            target_arch = "mips64",
            target_arch = "sparc",
            target_arch = "sparc64"
        ))
    ))]
    const FS_IOC_FSGETXATTR: libc::Ioctl = 0x801C_581F_u32 as libc::Ioctl;
    #[cfg(all(
        target_os = "linux",
        not(any(
            target_arch = "powerpc",
            target_arch = "powerpc64",
            target_arch = "mips",
            target_arch = "mips64",
            target_arch = "sparc",
            target_arch = "sparc64"
        ))
    ))]
    const FS_IOC_FSSETXATTR: libc::Ioctl = 0x401C_5820_u32 as libc::Ioctl;

    #[cfg(target_os = "linux")]
    fn read_linux_fsxattr(
        fd: std::os::fd::RawFd,
    ) -> io::Result<Option<super::LinuxFsxattrSnapshot>> {
        let mut attr = LinuxFsxattr {
            fsx_xflags: 0,
            fsx_extsize: 0,
            fsx_nextents: 0,
            fsx_projid: 0,
            fsx_cowextsize: 0,
            fsx_pad: [0; 8],
        };
        // SAFETY: Linux `FS_IOC_FSGETXATTR` writes a 28-byte `struct fsxattr`.
        if unsafe { libc::ioctl(fd, FS_IOC_FSGETXATTR, &mut attr) } == 0 {
            return Ok(Some(super::snapshot_from_linux_fsxattr(
                attr.fsx_xflags,
                attr.fsx_extsize,
                attr.fsx_projid,
                attr.fsx_cowextsize,
            )));
        }
        let error = io::Error::last_os_error();
        if matches!(
            error.raw_os_error(),
            Some(libc::ENOTTY | libc::EOPNOTSUPP | libc::EINVAL | libc::ENOSYS)
        ) {
            return Ok(None);
        }
        Err(error)
    }

    #[cfg(target_os = "linux")]
    fn apply_linux_fsxattr(
        temp_fd: std::os::fd::RawFd,
        expected_fsxattr: Option<super::LinuxFsxattrSnapshot>,
    ) -> io::Result<()> {
        let Some(expected) = expected_fsxattr else {
            return Ok(());
        };
        let mut attr = LinuxFsxattr {
            fsx_xflags: 0,
            fsx_extsize: 0,
            fsx_nextents: 0,
            fsx_projid: 0,
            fsx_cowextsize: 0,
            fsx_pad: [0; 8],
        };
        // SAFETY: Linux `FS_IOC_FSGETXATTR` writes a 28-byte `struct fsxattr`.
        if unsafe { libc::ioctl(temp_fd, FS_IOC_FSGETXATTR, &mut attr) } != 0 {
            let error = io::Error::last_os_error();
            if expected.is_default()
                && matches!(
                    error.raw_os_error(),
                    Some(libc::ENOTTY | libc::EOPNOTSUPP | libc::EINVAL | libc::ENOSYS)
                )
            {
                return Ok(());
            }
            return Err(error);
        }
        let current = super::snapshot_from_linux_fsxattr(
            attr.fsx_xflags,
            attr.fsx_extsize,
            attr.fsx_projid,
            attr.fsx_cowextsize,
        );
        if current != expected {
            let (next_xflags, next_extsize, next_projid, next_cowextsize) =
                super::merge_linux_fsxattr_for_set(attr.fsx_xflags, expected);
            attr.fsx_xflags = next_xflags;
            attr.fsx_extsize = next_extsize;
            attr.fsx_projid = next_projid;
            attr.fsx_cowextsize = next_cowextsize;
            // SAFETY: Linux `FS_IOC_FSSETXATTR` reads a 28-byte `struct fsxattr`.
            if unsafe { libc::ioctl(temp_fd, FS_IOC_FSSETXATTR, &mut attr) } != 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    error.kind(),
                    format!(
                        "cannot safely preserve Linux extended file allocation attributes on replacement: {error}"
                    ),
                ));
            }
            let mut verified = LinuxFsxattr {
                fsx_xflags: 0,
                fsx_extsize: 0,
                fsx_nextents: 0,
                fsx_projid: 0,
                fsx_cowextsize: 0,
                fsx_pad: [0; 8],
            };
            // SAFETY: Linux `FS_IOC_FSGETXATTR` writes a 28-byte `struct fsxattr`.
            if unsafe { libc::ioctl(temp_fd, FS_IOC_FSGETXATTR, &mut verified) } != 0 {
                return Err(io::Error::last_os_error());
            }
            let verified_snapshot = super::snapshot_from_linux_fsxattr(
                verified.fsx_xflags,
                verified.fsx_extsize,
                verified.fsx_projid,
                verified.fsx_cowextsize,
            );
            if verified_snapshot != expected {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "cannot verify Linux extended file allocation attributes preservation on replacement",
                ));
            }
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn apply_linux_pre_write_inode_flags(
        temp_fd: std::os::fd::RawFd,
        existing: &ExistingTarget,
    ) -> io::Result<()> {
        apply_linux_fsxattr(temp_fd, existing.linux_fsxattr)?;
        let Some(expected) = existing.linux_flags else {
            return Ok(());
        };
        let desired_pre = expected & LINUX_PRE_WRITE_INODE_FLAGS;
        let mut temp_raw: libc::c_int = 0;
        // SAFETY: Linux `FS_IOC_GETFLAGS` writes a 32-bit `int` flag bitmask.
        if unsafe { libc::ioctl(temp_fd, libc::FS_IOC_GETFLAGS, &mut temp_raw) } != 0 {
            let error = io::Error::last_os_error();
            if desired_pre == 0
                && matches!(
                    error.raw_os_error(),
                    Some(libc::ENOTTY | libc::EOPNOTSUPP | libc::EINVAL | libc::ENOSYS)
                )
            {
                return Ok(());
            }
            return Err(error);
        }
        if (temp_raw & LINUX_PRE_WRITE_INODE_FLAGS) != desired_pre {
            let mut next_flags = (temp_raw & !LINUX_PRE_WRITE_INODE_FLAGS) | desired_pre;
            // SAFETY: Linux `FS_IOC_SETFLAGS` reads a 32-bit `int` flag bitmask.
            if unsafe { libc::ioctl(temp_fd, libc::FS_IOC_SETFLAGS, &mut next_flags) } != 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    error.kind(),
                    format!(
                        "cannot safely preserve Linux inode storage flags on replacement: {error}"
                    ),
                ));
            }
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn apply_linux_post_write_inode_flags(
        temp_fd: std::os::fd::RawFd,
        existing: &ExistingTarget,
    ) -> io::Result<()> {
        let Some(expected) = existing.linux_flags else {
            return Ok(());
        };
        let mut temp_raw: libc::c_int = 0;
        // SAFETY: Linux `FS_IOC_GETFLAGS` writes a 32-bit `int` flag bitmask.
        if unsafe { libc::ioctl(temp_fd, libc::FS_IOC_GETFLAGS, &mut temp_raw) } != 0 {
            let error = io::Error::last_os_error();
            if expected == 0
                && matches!(
                    error.raw_os_error(),
                    Some(libc::ENOTTY | libc::EOPNOTSUPP | libc::EINVAL | libc::ENOSYS)
                )
            {
                return Ok(());
            }
            return Err(error);
        }
        if (temp_raw & LINUX_USER_MODIFIABLE_INODE_FLAGS) != expected {
            let mut next_flags = (temp_raw & !LINUX_USER_MODIFIABLE_INODE_FLAGS) | expected;
            // SAFETY: Linux `FS_IOC_SETFLAGS` reads a 32-bit `int` flag bitmask.
            if unsafe { libc::ioctl(temp_fd, libc::FS_IOC_SETFLAGS, &mut next_flags) } != 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    error.kind(),
                    format!("cannot safely preserve Linux inode flags on replacement: {error}"),
                ));
            }
            let mut verified: libc::c_int = 0;
            // SAFETY: Linux `FS_IOC_GETFLAGS` writes a 32-bit `int` flag bitmask.
            if unsafe { libc::ioctl(temp_fd, libc::FS_IOC_GETFLAGS, &mut verified) } != 0 {
                return Err(io::Error::last_os_error());
            }
            if (verified & LINUX_USER_MODIFIABLE_INODE_FLAGS) != expected {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "cannot verify Linux inode flags preservation on replacement",
                ));
            }
        }
        Ok(())
    }

    #[cfg(any(target_os = "freebsd", target_os = "netbsd"))]
    fn check_bsd_system_extattrs(fd: std::os::fd::RawFd) -> io::Result<()> {
        let mut names_buf = Vec::new();
        let mut listed = false;
        for _ in 0..4 {
            // SAFETY: querying system-namespace extattr list size with null buffer.
            let size = unsafe {
                libc::extattr_list_fd(fd, libc::EXTATTR_NAMESPACE_SYSTEM, std::ptr::null_mut(), 0)
            };
            if size < 0 {
                let error = io::Error::last_os_error();
                let raw = error.raw_os_error();
                if raw == Some(libc::EOPNOTSUPP)
                    || raw == Some(libc::ENOTSUP)
                    || raw == Some(libc::ENOSYS)
                {
                    return Ok(());
                }
                return Err(error);
            }
            if size == 0 {
                return Ok(());
            }
            names_buf.resize(usize::try_from(size).unwrap_or(0), 0u8);
            // SAFETY: `names_buf` has `names_buf.len()` writable bytes.
            let read = unsafe {
                libc::extattr_list_fd(
                    fd,
                    libc::EXTATTR_NAMESPACE_SYSTEM,
                    names_buf.as_mut_ptr().cast::<libc::c_void>(),
                    names_buf.len(),
                )
            };
            if read >= 0 {
                names_buf.truncate(usize::try_from(read).unwrap_or(0));
                listed = true;
                break;
            }
            let error = io::Error::last_os_error();
            let raw = error.raw_os_error();
            if raw == Some(libc::ERANGE) {
                continue;
            }
            if raw == Some(libc::EOPNOTSUPP)
                || raw == Some(libc::ENOTSUP)
                || raw == Some(libc::ENOSYS)
            {
                return Ok(());
            }
            return Err(error);
        }
        if !listed {
            return Err(io::Error::other(
                "system extended attribute list changed concurrently during destination snapshot",
            ));
        }
        let mut offset = 0usize;
        while offset < names_buf.len() {
            let name_len = usize::from(names_buf[offset]);
            offset += 1;
            if offset + name_len > names_buf.len() {
                break;
            }
            let raw_name = &names_buf[offset..offset + name_len];
            offset += name_len;
            if raw_name.is_empty() || super::is_bsd_acl_system_extattr(raw_name) {
                continue;
            }
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                format!(
                    "cannot safely preserve BSD system extended attribute {} across atomic replacement",
                    String::from_utf8_lossy(raw_name)
                ),
            ));
        }
        Ok(())
    }

    #[cfg(any(target_os = "freebsd", target_os = "netbsd"))]
    fn read_existing_user_xattrs(fd: std::os::fd::RawFd) -> io::Result<Vec<(CString, Vec<u8>)>> {
        check_bsd_system_extattrs(fd)?;
        let mut names_buf = Vec::new();
        let mut listed = false;
        for _ in 0..4 {
            // SAFETY: querying list size with null buffer.
            let size = unsafe {
                libc::extattr_list_fd(fd, libc::EXTATTR_NAMESPACE_USER, std::ptr::null_mut(), 0)
            };
            if size < 0 {
                let error = io::Error::last_os_error();
                let raw = error.raw_os_error();
                if raw == Some(libc::EOPNOTSUPP)
                    || raw == Some(libc::ENOTSUP)
                    || raw == Some(libc::ENOSYS)
                {
                    return Ok(Vec::new());
                }
                return Err(error);
            }
            if size == 0 {
                return Ok(Vec::new());
            }
            names_buf.resize(usize::try_from(size).unwrap_or(0), 0u8);
            // SAFETY: `names_buf` has `names_buf.len()` writable bytes.
            let read = unsafe {
                libc::extattr_list_fd(
                    fd,
                    libc::EXTATTR_NAMESPACE_USER,
                    names_buf.as_mut_ptr().cast::<libc::c_void>(),
                    names_buf.len(),
                )
            };
            if read >= 0 {
                names_buf.truncate(usize::try_from(read).unwrap_or(0));
                listed = true;
                break;
            }
            let error = io::Error::last_os_error();
            let raw = error.raw_os_error();
            if raw == Some(libc::ERANGE) {
                continue;
            }
            if raw == Some(libc::EOPNOTSUPP)
                || raw == Some(libc::ENOTSUP)
                || raw == Some(libc::ENOSYS)
            {
                return Ok(Vec::new());
            }
            return Err(error);
        }
        if !listed {
            return Err(io::Error::other(
                "extended attribute list changed concurrently during destination snapshot",
            ));
        }

        // BSD `extattr_list_fd` returns `[len: u8][name bytes...]` records.
        let mut xattrs = Vec::new();
        let mut offset = 0usize;
        while offset < names_buf.len() {
            let name_len = usize::from(names_buf[offset]);
            offset += 1;
            if offset + name_len > names_buf.len() {
                break;
            }
            let raw_name = &names_buf[offset..offset + name_len];
            offset += name_len;
            if raw_name.is_empty() {
                continue;
            }
            let Ok(c_name) = CString::new(raw_name) else {
                continue;
            };
            let mut outcome: Option<Option<Vec<u8>>> = None;
            for _ in 0..4 {
                // SAFETY: querying attribute size with null buffer.
                let size = unsafe {
                    libc::extattr_get_fd(
                        fd,
                        libc::EXTATTR_NAMESPACE_USER,
                        c_name.as_ptr(),
                        std::ptr::null_mut(),
                        0,
                    )
                };
                if size < 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::ENOATTR) {
                        outcome = Some(None);
                        break;
                    }
                    return Err(error);
                }
                let mut value = vec![0u8; usize::try_from(size).unwrap_or(0)];
                if value.is_empty() {
                    outcome = Some(Some(value));
                    break;
                }
                // SAFETY: `value` has `value.len()` writable bytes.
                let read = unsafe {
                    libc::extattr_get_fd(
                        fd,
                        libc::EXTATTR_NAMESPACE_USER,
                        c_name.as_ptr(),
                        value.as_mut_ptr().cast::<libc::c_void>(),
                        value.len(),
                    )
                };
                if read >= 0 {
                    value.truncate(usize::try_from(read).unwrap_or(0));
                    outcome = Some(Some(value));
                    break;
                }
                let error = io::Error::last_os_error();
                let raw = error.raw_os_error();
                if raw == Some(libc::ERANGE) {
                    continue;
                }
                if raw == Some(libc::ENOATTR) {
                    outcome = Some(None);
                    break;
                }
                return Err(error);
            }
            match outcome {
                Some(Some(value)) => xattrs.push((c_name, value)),
                Some(None) => {}
                None => {
                    return Err(io::Error::other(
                        "extended attribute value changed concurrently during destination snapshot",
                    ));
                }
            }
        }
        xattrs.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
        Ok(xattrs)
    }

    #[cfg(any(target_os = "freebsd", target_os = "netbsd"))]
    fn apply_existing_user_xattrs(
        temp_fd: std::os::fd::RawFd,
        xattrs: &[(CString, Vec<u8>)],
    ) -> io::Result<()> {
        for (name, value) in xattrs {
            // SAFETY: `temp_fd` is open, `name` is NUL-terminated, and
            // `value.as_ptr()` is valid for `value.len()` bytes.
            let written = unsafe {
                libc::extattr_set_fd(
                    temp_fd,
                    libc::EXTATTR_NAMESPACE_USER,
                    name.as_ptr(),
                    value.as_ptr().cast::<libc::c_void>(),
                    value.len(),
                )
            };
            if written < 0 {
                return Err(io::Error::last_os_error());
            }
            if usize::try_from(written).ok() != Some(value.len()) {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "short write while restoring BSD user extended attribute",
                ));
            }
        }
        Ok(())
    }

    #[cfg(target_os = "openbsd")]
    fn read_existing_user_xattrs(_fd: std::os::fd::RawFd) -> io::Result<Vec<(CString, Vec<u8>)>> {
        // OpenBSD does not support extended attributes.
        Ok(Vec::new())
    }

    #[cfg(target_os = "openbsd")]
    fn apply_existing_user_xattrs(
        _temp_fd: std::os::fd::RawFd,
        _xattrs: &[(CString, Vec<u8>)],
    ) -> io::Result<()> {
        Ok(())
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "linux",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn read_existing_user_xattrs(_fd: std::os::fd::RawFd) -> io::Result<Vec<(CString, Vec<u8>)>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot verify or preserve user extended attributes on this Unix target",
        ))
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "linux",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    fn apply_existing_user_xattrs(
        _temp_fd: std::os::fd::RawFd,
        _xattrs: &[(CString, Vec<u8>)],
    ) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "cannot preserve user extended attributes on this Unix target",
        ))
    }

    fn restore_existing_metadata(
        temp_fd: std::os::fd::RawFd,
        existing: &ExistingTarget,
    ) -> io::Result<()> {
        apply_existing_user_xattrs(temp_fd, &existing.xattrs)?;
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
        // Clear `S_ISUID` and `S_ISGID` when publishing new file contents so
        // replacement never preserves privilege bits that an in-place Unix
        // write would strip, while retaining ordinary permissions and sticky bit.
        let target_mode = existing.entry.mode & !(libc::S_ISUID | libc::S_ISGID);
        if (temp_stat.st_mode & 0o7777) != target_mode {
            // SAFETY: `temp_fd` is an open file descriptor.
            if unsafe { libc::fchmod(temp_fd, target_mode) } != 0 {
                return Err(io::Error::last_os_error());
            }
        }
        if let Some(acl) = existing.acl.as_ref() {
            apply_existing_acl(temp_fd, acl)?;
        }
        #[cfg(target_os = "linux")]
        apply_linux_post_write_inode_flags(temp_fd, existing)?;
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            // Replacement writes a normal uncompressed data fork (matching
            // `fs::write` on an existing compressed file and skipping
            // `com.apple.decmpfs`), so mask off `UF_COMPRESSED` rather than
            // attempting to apply it to an uncompressed inode.
            let target_flags = existing.entry.flags & !libc::UF_COMPRESSED;
            if target_flags != temp_stat.st_flags {
                // SAFETY: `temp_fd` is an open file descriptor we just staged.
                if unsafe { libc::fchflags(temp_fd, target_flags) } != 0 {
                    let error = io::Error::last_os_error();
                    return Err(io::Error::new(
                        error.kind(),
                        format!(
                            "cannot safely preserve original BSD file flags on replacement: {error}"
                        ),
                    ));
                }
            }
        }
        #[cfg(target_os = "openbsd")]
        if existing.entry.flags != temp_stat.st_flags {
            // SAFETY: `temp_fd` is an open file descriptor we just staged.
            if unsafe { libc::fchflags(temp_fd, existing.entry.flags) } != 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    error.kind(),
                    format!(
                        "cannot safely preserve original BSD file flags on replacement: {error}"
                    ),
                ));
            }
        }
        #[cfg(any(target_os = "freebsd", target_os = "netbsd"))]
        if existing.entry.flags != temp_stat.st_flags {
            // SAFETY: `temp_fd` is an open file descriptor we just staged;
            // FreeBSD and NetBSD declare `fchflags`'s second argument as `c_ulong`.
            if unsafe { libc::fchflags(temp_fd, libc::c_ulong::from(existing.entry.flags)) } != 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    error.kind(),
                    format!(
                        "cannot safely preserve original BSD file flags on replacement: {error}"
                    ),
                ));
            }
        }
        Ok(())
    }

    fn os_str_to_cstring(value: &OsStr) -> Result<CString, ContainedFsError> {
        CString::new(value.as_bytes()).map_err(|_| {
            ContainedFsError::Containment("path component contains an interior NUL byte".to_owned())
        })
    }
}

#[cfg(any(target_os = "linux", test))]
const fn is_linux_smb_magic(f_type: u32) -> bool {
    const SMB_SUPER_MAGIC: u32 = 0x517b;
    const CIFS_SUPER_MAGIC: u32 = 0xff53_4d42;
    const SMB2_SUPER_MAGIC: u32 = 0xfe53_4d42;
    matches!(
        f_type,
        SMB_SUPER_MAGIC | CIFS_SUPER_MAGIC | SMB2_SUPER_MAGIC
    )
}

#[cfg(any(target_os = "linux", test))]
const fn classify_linux_fs_magic(
    f_type: u32,
    checked_casefold_flag: bool,
) -> Option<DirFilenameEquivalence> {
    const MSDOS_SUPER_MAGIC: u32 = 0x4d44;
    const EXFAT_SUPER_MAGIC: u32 = 0x2011_bab0;
    const EXT4_SUPER_MAGIC: u32 = 0xef53;
    const TMPFS_MAGIC: u32 = 0x0102_1994;
    const BTRFS_SUPER_MAGIC: u32 = 0x9123_683e;
    const F2FS_SUPER_MAGIC: u32 = 0xf2f5_2010;
    if matches!(f_type, MSDOS_SUPER_MAGIC | EXFAT_SUPER_MAGIC) {
        return Some(DirFilenameEquivalence::CaseInsensitiveNtfs);
    }
    if f_type == BTRFS_SUPER_MAGIC
        || (checked_casefold_flag
            && matches!(f_type, EXT4_SUPER_MAGIC | TMPFS_MAGIC | F2FS_SUPER_MAGIC))
    {
        return Some(DirFilenameEquivalence::Exact);
    }
    None
}

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LinuxFsxattrSnapshot {
    xflags: u32,
    extsize: u32,
    projid: u32,
    cowextsize: u32,
}

#[cfg(any(target_os = "linux", test))]
impl LinuxFsxattrSnapshot {
    const fn is_default(self) -> bool {
        self.xflags == 0 && self.extsize == 0 && self.projid == 0 && self.cowextsize == 0
    }
}

#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_REALTIME: u32 = 0x0000_0001;
#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_PREALLOC: u32 = 0x0000_0002;
#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_EXTSIZE: u32 = 0x0000_0800;
#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_NODEFRAG: u32 = 0x0000_2000;
#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_FILESTREAM: u32 = 0x0000_4000;
#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_DAX: u32 = 0x0000_8000;
#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_COWEXTSIZE: u32 = 0x0001_0000;
#[cfg(any(target_os = "linux", test))]
const LINUX_FS_XFLAG_HASATTR: u32 = 0x8000_0000;

/// Settable `fsx_xflags` allocation/storage policy bits from `<uapi/linux/fs.h>`
/// not already managed via `FS_IOC_GETFLAGS`/`FS_IOC_SETFLAGS`.
#[cfg(any(target_os = "linux", test))]
const LINUX_PRESERVED_FSX_XFLAGS: u32 = LINUX_FS_XFLAG_REALTIME
    | LINUX_FS_XFLAG_EXTSIZE
    | LINUX_FS_XFLAG_NODEFRAG
    | LINUX_FS_XFLAG_FILESTREAM
    | LINUX_FS_XFLAG_DAX
    | LINUX_FS_XFLAG_COWEXTSIZE;

/// Read-only status bits returned by `FS_IOC_FSGETXATTR` that must never be
/// echoed back into `FS_IOC_FSSETXATTR`.
#[cfg(any(target_os = "linux", test))]
const LINUX_READONLY_FSX_XFLAGS: u32 = LINUX_FS_XFLAG_PREALLOC | LINUX_FS_XFLAG_HASATTR;

#[cfg(any(target_os = "linux", test))]
const fn snapshot_from_linux_fsxattr(
    xflags: u32,
    extsize: u32,
    projid: u32,
    cowextsize: u32,
) -> LinuxFsxattrSnapshot {
    let preserved = xflags & LINUX_PRESERVED_FSX_XFLAGS;
    LinuxFsxattrSnapshot {
        xflags: preserved,
        extsize: if (preserved & LINUX_FS_XFLAG_EXTSIZE) != 0 {
            extsize
        } else {
            0
        },
        projid,
        cowextsize: if (preserved & LINUX_FS_XFLAG_COWEXTSIZE) != 0 {
            cowextsize
        } else {
            0
        },
    }
}

#[cfg(any(target_os = "linux", test))]
const fn merge_linux_fsxattr_for_set(
    current_xflags: u32,
    expected: LinuxFsxattrSnapshot,
) -> (u32, u32, u32, u32) {
    let next_xflags = (current_xflags & !(LINUX_PRESERVED_FSX_XFLAGS | LINUX_READONLY_FSX_XFLAGS))
        | expected.xflags;
    (
        next_xflags,
        expected.extsize,
        expected.projid,
        expected.cowextsize,
    )
}

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LinuxCopyableXattrKind {
    Copyable,
    UnpreservableTrusted,
    Ignore,
}

#[cfg(any(target_os = "linux", test))]
fn classify_linux_xattr_for_copy(name: &[u8]) -> LinuxCopyableXattrKind {
    if name.starts_with(b"user.") {
        return LinuxCopyableXattrKind::Copyable;
    }
    if name.starts_with(b"trusted.") {
        // Filesystem-internal `trusted.*` attributes (OverlayFS, GlusterFS,
        // SGI/XFS) encode storage-layer structure bound to the original inode
        // and must neither be copied blindly nor silently discarded.
        if name.starts_with(b"trusted.overlay.")
            || name.starts_with(b"trusted.glusterfs.")
            || name.starts_with(b"trusted.afr.")
            || name.starts_with(b"trusted.pgfid.")
            || name.starts_with(b"trusted.ec.")
            || name.starts_with(b"trusted.bit-rot.")
            || name.starts_with(b"trusted.SGI_")
            || name == b"trusted.gfid"
        {
            return LinuxCopyableXattrKind::UnpreservableTrusted;
        }
        return LinuxCopyableXattrKind::Copyable;
    }
    LinuxCopyableXattrKind::Ignore
}

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LinuxSecurityXattrKind {
    CopyableAccessLabel,
    UnpreservableIntegrityOrUnknown,
}

#[cfg(any(target_os = "freebsd", target_os = "netbsd", test))]
fn is_bsd_acl_system_extattr(name: &[u8]) -> bool {
    matches!(
        name,
        b"posix1e.acl_access" | b"posix1e.acl_default" | b"nfs4.acl"
    )
}

#[cfg(any(target_os = "linux", test))]
fn classify_linux_security_xattr(name: &[u8]) -> LinuxSecurityXattrKind {
    match name {
        b"security.selinux"
        | b"security.SMACK64"
        | b"security.SMACK64EXEC"
        | b"security.SMACK64MMAP"
        | b"security.SMACK64TRANSMUTE"
        | b"security.apparmor" => LinuxSecurityXattrKind::CopyableAccessLabel,
        _ => LinuxSecurityXattrKind::UnpreservableIntegrityOrUnknown,
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowsTxfOpenDisposition {
    NotFound,
    Retry,
    Unsupported,
    Error,
}

#[cfg(any(windows, test))]
const fn classify_windows_txf_open_status(status: i32) -> WindowsTxfOpenDisposition {
    // Verified Windows SDK `ntstatus.h` values (`FACILITY_TXFS = 0x19`).
    const STATUS_NOT_IMPLEMENTED: i32 = 0xC000_0002_u32 as i32;
    const STATUS_INVALID_DEVICE_REQUEST: i32 = 0xC000_0010_u32 as i32;
    const STATUS_OBJECT_NAME_NOT_FOUND: i32 = 0xC000_0034_u32 as i32;
    const STATUS_OBJECT_PATH_NOT_FOUND: i32 = 0xC000_003A_u32 as i32;
    const STATUS_SHARING_VIOLATION: i32 = 0xC000_0043_u32 as i32;
    const STATUS_NOT_SUPPORTED: i32 = 0xC000_00BB_u32 as i32;
    const STATUS_TRANSACTIONAL_CONFLICT: i32 = 0xC019_0001_u32 as i32;
    const STATUS_RM_NOT_ACTIVE: i32 = 0xC019_0005_u32 as i32;
    const STATUS_TRANSACTIONS_UNSUPPORTED_REMOTE: i32 = 0xC019_000A_u32 as i32;
    const STATUS_EFS_NOT_ALLOWED_IN_TRANSACTION: i32 = 0xC019_003E_u32 as i32;
    const STATUS_TRANSACTIONAL_OPEN_NOT_ALLOWED: i32 = 0xC019_003F_u32 as i32;

    match status {
        STATUS_OBJECT_NAME_NOT_FOUND | STATUS_OBJECT_PATH_NOT_FOUND => {
            WindowsTxfOpenDisposition::NotFound
        }
        STATUS_SHARING_VIOLATION | STATUS_TRANSACTIONAL_CONFLICT => {
            WindowsTxfOpenDisposition::Retry
        }
        STATUS_NOT_IMPLEMENTED
        | STATUS_INVALID_DEVICE_REQUEST
        | STATUS_NOT_SUPPORTED
        | STATUS_RM_NOT_ACTIVE
        | STATUS_TRANSACTIONS_UNSUPPORTED_REMOTE
        | STATUS_EFS_NOT_ALLOWED_IN_TRANSACTION
        | STATUS_TRANSACTIONAL_OPEN_NOT_ALLOWED => WindowsTxfOpenDisposition::Unsupported,
        _ => WindowsTxfOpenDisposition::Error,
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
        FileIdentity, validate_dir_segment, validate_relative_dir_segments,
        validate_single_file_name,
    };

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    type NtStatus = i32;

    const STATUS_OBJECT_NAME_NOT_FOUND: NtStatus = 0xC000_0034_u32 as i32;
    const STATUS_OBJECT_PATH_NOT_FOUND: NtStatus = 0xC000_003A_u32 as i32;
    const STATUS_OBJECT_NAME_COLLISION: NtStatus = 0xC000_0035_u32 as i32;
    const STATUS_BUFFER_OVERFLOW: NtStatus = 0x8000_0005_u32 as i32;
    const STATUS_NOT_IMPLEMENTED: NtStatus = 0xC000_0002_u32 as i32;
    const STATUS_INVALID_PARAMETER: NtStatus = 0xC000_000D_u32 as i32;
    const STATUS_INVALID_DEVICE_REQUEST: NtStatus = 0xC000_0010_u32 as i32;
    const STATUS_NOT_SUPPORTED: NtStatus = 0xC000_00BB_u32 as i32;
    const ERROR_INVALID_FUNCTION: i32 = 1;
    const ERROR_NOT_SUPPORTED: i32 = 50;
    const ERROR_INSUFFICIENT_BUFFER: i32 = 122;

    const FILE_WRITE_DATA: u32 = 0x0000_0002;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const FILE_WRITE_ATTRIBUTES: u32 = 0x0000_0100;
    const FILE_TRAVERSE: u32 = 0x0000_0020;
    const DELETE: u32 = 0x0001_0000;
    const READ_CONTROL: u32 = 0x0002_0000;
    const WRITE_DAC: u32 = 0x0004_0000;
    const WRITE_OWNER: u32 = 0x0008_0000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const ACCESS_SYSTEM_SECURITY: u32 = 0x0100_0000;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x0000_0004;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_ARCHIVE: u32 = 0x0000_0020;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;
    const FILE_ATTRIBUTE_SPARSE_FILE: u32 = 0x0000_0200;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_ATTRIBUTE_COMPRESSED: u32 = 0x0000_0800;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x0000_1000;
    const FILE_ATTRIBUTE_NOT_CONTENT_INDEXED: u32 = 0x0000_2000;
    const FILE_ATTRIBUTE_ENCRYPTED: u32 = 0x0000_4000;
    const FILE_ATTRIBUTE_INTEGRITY_STREAM: u32 = 0x0000_8000;
    const FILE_ATTRIBUTE_NO_SCRUB_DATA: u32 = 0x0002_0000;
    const FILE_ATTRIBUTE_PINNED: u32 = 0x0008_0000;
    const FILE_ATTRIBUTE_UNPINNED: u32 = 0x0010_0000;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

    const PRESERVED_BASIC_ATTRIBUTES: u32 = FILE_ATTRIBUTE_HIDDEN
        | FILE_ATTRIBUTE_SYSTEM
        | FILE_ATTRIBUTE_ARCHIVE
        | FILE_ATTRIBUTE_TEMPORARY
        | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED;
    const UNPRESERVABLE_STORAGE_ATTRIBUTES: u32 = FILE_ATTRIBUTE_SPARSE_FILE
        | FILE_ATTRIBUTE_OFFLINE
        | FILE_ATTRIBUTE_INTEGRITY_STREAM
        | FILE_ATTRIBUTE_NO_SCRUB_DATA
        | FILE_ATTRIBUTE_PINNED
        | FILE_ATTRIBUTE_UNPINNED;
    const FSCTL_SET_COMPRESSION: u32 = 0x0009_C040;
    const COMPRESSION_FORMAT_NONE: u16 = 0;
    const COMPRESSION_FORMAT_DEFAULT: u16 = 1;

    const FILE_OPEN: u32 = 0x0000_0001;
    const FILE_CREATE: u32 = 0x0000_0002;
    const FILE_OPEN_IF: u32 = 0x0000_0003;
    const FILE_DIRECTORY_FILE: u32 = 0x0000_0001;
    const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x0000_0020;
    const FILE_NON_DIRECTORY_FILE: u32 = 0x0000_0040;
    const FILE_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const OBJ_CASE_INSENSITIVE: u32 = 0x0000_0040;
    const FILE_BASIC_INFORMATION_CLASS: u32 = 4;
    const FILE_EA_INFORMATION_CLASS: u32 = 7;
    const FILE_RENAME_INFORMATION_CLASS: u32 = 10;
    const FILE_DISPOSITION_INFORMATION_CLASS: u32 = 13;
    const FILE_STREAM_INFORMATION_CLASS: u32 = 22;
    const OWNER_SECURITY_INFORMATION: u32 = 0x0000_0001;
    const GROUP_SECURITY_INFORMATION: u32 = 0x0000_0002;
    const DACL_SECURITY_INFORMATION: u32 = 0x0000_0004;
    const SACL_SECURITY_INFORMATION: u32 = 0x0000_0008;
    const LABEL_SECURITY_INFORMATION: u32 = 0x0000_0010;
    const ATTRIBUTE_SECURITY_INFORMATION: u32 = 0x0000_0020;
    const SCOPE_SECURITY_INFORMATION: u32 = 0x0000_0040;
    const SE_DACL_PROTECTED: u16 = 0x1000;
    const SE_SACL_PROTECTED: u16 = 0x2000;
    const STATUS_ACCESS_DENIED: NtStatus = 0xC000_0022_u32 as i32;
    const STATUS_PRIVILEGE_NOT_HELD: NtStatus = 0xC000_0061_u32 as i32;
    const LOAD_LIBRARY_SEARCH_SYSTEM32: u32 = 0x0000_0800;
    const INVALID_HANDLE_VALUE: *mut c_void = -1_isize as *mut c_void;

    #[repr(C)]
    struct FileBasicInformation {
        creation_time: i64,
        last_access_time: i64,
        last_write_time: i64,
        change_time: i64,
        file_attributes: u32,
        _padding: u32,
    }

    #[repr(C)]
    struct FileEaInformation {
        ea_size: u32,
    }

    #[repr(C)]
    struct FileStreamInformation {
        next_entry_offset: u32,
        stream_name_length: u32,
        stream_size: i64,
        stream_allocation_size: i64,
        stream_name: [u16; 1],
    }

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
        group_sd: Option<Vec<usize>>,
        dacl_sd: Option<Vec<usize>>,
        label_sd: Option<Vec<usize>>,
        sacl_sd: Option<Vec<usize>>,
        sacl_accessible: bool,
        attribute_sd: Option<Vec<usize>>,
        scope_sd: Option<Vec<usize>>,
        file_attributes: u32,
        is_encrypted: bool,
        has_named_streams: bool,
        has_extended_attributes: bool,
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

    const FILE_DELETE_ON_CLOSE: u32 = 0x0000_1000;
    const STATUS_SHARING_VIOLATION: NtStatus = 0xC000_0043_u32 as i32;
    const STATUS_DELETE_PENDING: NtStatus = 0xC000_0056_u32 as i32;
    const FILE_READ_DATA: u32 = 0x0000_0001;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
    const FILE_ATTRIBUTE_TEMPORARY: u32 = 0x0000_0100;

    const FILE_ID_INFO_CLASS: i32 = 18;

    #[repr(C)]
    struct FileIdInfo {
        volume_serial_number: u64,
        file_id: [u8; 16],
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandle(
            file: *mut c_void,
            file_information: *mut ByHandleFileInformation,
        ) -> i32;
        fn GetFileInformationByHandleEx(
            file: *mut c_void,
            file_information_class: i32,
            file_information: *mut c_void,
            buffer_size: u32,
        ) -> i32;
        fn DeviceIoControl(
            device: *mut c_void,
            io_control_code: u32,
            in_buffer: *mut c_void,
            in_buffer_size: u32,
            out_buffer: *mut c_void,
            out_buffer_size: u32,
            bytes_returned: *mut u32,
            overlapped: *mut c_void,
        ) -> i32;
        fn LoadLibraryExW(lib_file_name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
        fn GetModuleHandleW(module_name: *const u16) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, proc_name: *const u8) -> *mut c_void;
    }

    type CreateTransactionFn = unsafe extern "system" fn(
        *mut c_void,
        *mut c_void,
        u32,
        u32,
        u32,
        u32,
        *mut u16,
    ) -> *mut c_void;
    type CommitTransactionFn = unsafe extern "system" fn(*mut c_void) -> i32;
    type RollbackTransactionFn = unsafe extern "system" fn(*mut c_void) -> i32;
    type RtlGetCurrentTransactionFn = unsafe extern "system" fn() -> *mut c_void;
    type RtlSetCurrentTransactionFn = unsafe extern "system" fn(*mut c_void) -> u8;

    #[derive(Clone, Copy)]
    struct WindowsTxfApi {
        create_transaction: CreateTransactionFn,
        commit_transaction: CommitTransactionFn,
        rollback_transaction: RollbackTransactionFn,
        rtl_get_current_transaction: RtlGetCurrentTransactionFn,
        rtl_set_current_transaction: RtlSetCurrentTransactionFn,
    }

    static WINDOWS_TXF_API: std::sync::OnceLock<Option<WindowsTxfApi>> = std::sync::OnceLock::new();

    fn load_windows_txf_api() -> Option<WindowsTxfApi> {
        *WINDOWS_TXF_API.get_or_init(|| {
            let ktmw32: Vec<u16> = "ktmw32.dll\0".encode_utf16().collect();
            let ntdll: Vec<u16> = "ntdll.dll\0".encode_utf16().collect();
            // SAFETY: NUL-terminated UTF-16 system DLL names and ASCII symbol
            // names; `LOAD_LIBRARY_SEARCH_SYSTEM32` restricts loading strictly
            // to `%SystemRoot%\System32`.
            unsafe {
                let ktm_mod = LoadLibraryExW(
                    ktmw32.as_ptr(),
                    std::ptr::null_mut(),
                    LOAD_LIBRARY_SEARCH_SYSTEM32,
                );
                let nt_mod = GetModuleHandleW(ntdll.as_ptr());
                if ktm_mod.is_null() || nt_mod.is_null() {
                    return None;
                }
                let create_ptr = GetProcAddress(ktm_mod, b"CreateTransaction\0".as_ptr());
                let commit_ptr = GetProcAddress(ktm_mod, b"CommitTransaction\0".as_ptr());
                let rollback_ptr = GetProcAddress(ktm_mod, b"RollbackTransaction\0".as_ptr());
                let get_tx_ptr = GetProcAddress(nt_mod, b"RtlGetCurrentTransaction\0".as_ptr());
                let set_tx_ptr = GetProcAddress(nt_mod, b"RtlSetCurrentTransaction\0".as_ptr());
                if create_ptr.is_null()
                    || commit_ptr.is_null()
                    || rollback_ptr.is_null()
                    || get_tx_ptr.is_null()
                    || set_tx_ptr.is_null()
                {
                    return None;
                }
                Some(WindowsTxfApi {
                    create_transaction: std::mem::transmute::<*mut c_void, CreateTransactionFn>(
                        create_ptr,
                    ),
                    commit_transaction: std::mem::transmute::<*mut c_void, CommitTransactionFn>(
                        commit_ptr,
                    ),
                    rollback_transaction: std::mem::transmute::<*mut c_void, RollbackTransactionFn>(
                        rollback_ptr,
                    ),
                    rtl_get_current_transaction: std::mem::transmute::<
                        *mut c_void,
                        RtlGetCurrentTransactionFn,
                    >(get_tx_ptr),
                    rtl_set_current_transaction: std::mem::transmute::<
                        *mut c_void,
                        RtlSetCurrentTransactionFn,
                    >(set_tx_ptr),
                })
            }
        })
    }

    enum TransactedOverwriteOutcome {
        Committed,
        Unsupported,
    }

    struct TransactionGuard {
        handle: OwnedHandle,
        rollback: RollbackTransactionFn,
        committed: bool,
    }

    impl Drop for TransactionGuard {
        fn drop(&mut self) {
            if !self.committed {
                // SAFETY: `self.handle` is an open KTM transaction handle.
                unsafe {
                    let _ = (self.rollback)(self.handle.as_raw_handle());
                }
            }
        }
    }

    struct ThreadTransactionGuard {
        previous: *mut c_void,
        set_tx: RtlSetCurrentTransactionFn,
    }

    impl Drop for ThreadTransactionGuard {
        fn drop(&mut self) {
            // SAFETY: restores the calling thread's prior TEB transaction handle.
            unsafe {
                let _ = (self.set_tx)(self.previous);
            }
        }
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
        fn GetSecurityDescriptorGroup(
            security_descriptor: *mut c_void,
            group: *mut *mut c_void,
            group_defaulted: *mut i32,
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
        fn GetSecurityDescriptorSacl(
            security_descriptor: *mut c_void,
            sacl_present: *mut i32,
            sacl: *mut *mut c_void,
            sacl_defaulted: *mut i32,
        ) -> i32;
        fn EqualSid(sid1: *mut c_void, sid2: *mut c_void) -> i32;
    }

    #[repr(C)]
    struct FileCaseSensitiveInformation {
        flags: u32,
    }

    const FILE_CASE_SENSITIVE_INFORMATION_CLASS: u32 = 71;
    const FILE_CS_FLAG_CASE_SENSITIVE_DIR: u32 = 0x0000_0001;

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
        fn NtQueryInformationFile(
            file_handle: *mut c_void,
            io_status_block: *mut IoStatusBlock,
            file_information: *mut c_void,
            length: u32,
            file_information_class: u32,
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

    #[derive(Debug)]
    struct WindowsDirTargetLock {
        key: super::TargetLockKey,
        _handle: OwnedHandle,
    }

    impl Drop for WindowsDirTargetLock {
        fn drop(&mut self) {
            HELD_WINDOWS_LOCKS.with(|held| {
                let mut map = held.borrow_mut();
                if map
                    .get(&self.key)
                    .is_some_and(|weak| weak.strong_count() == 0)
                {
                    map.remove(&self.key);
                }
            });
        }
    }

    thread_local! {
        static HELD_WINDOWS_LOCKS: std::cell::RefCell<
            std::collections::HashMap<super::TargetLockKey, std::rc::Weak<WindowsDirTargetLock>>,
        > = std::cell::RefCell::new(std::collections::HashMap::new());
    }

    /// Exclusive cross-process, cross-session, and cross-thread guard
    /// serializing catalog read-modify-write operations on Windows via a
    /// handle-pinned, delete-on-close exclusive lock file in the destination
    /// directory.
    ///
    /// Deliberately `!Send` and `!Sync` (via [`std::rc::Rc`]) so the OS lock is
    /// always released on the acquiring thread when the last reentrant guard drops.
    #[derive(Debug)]
    pub struct ContainedTargetLock {
        _lock: std::rc::Rc<WindowsDirTargetLock>,
    }

    const WINDOWS_DIR_LOCK_NAME: &str = ".pmds-lock";
    static DIR_INSTANCE_NONCE: AtomicU64 = AtomicU64::new(1);

    /// Open directory handle on Windows used for strictly handle-relative child
    /// operations via `NtCreateFile` and `NtSetInformationFile`.
    #[derive(Debug)]
    pub struct ContainedDir {
        handle: OwnedHandle,
        instance_id: u64,
    }

    impl ContainedDir {
        fn from_handle(handle: OwnedHandle) -> Self {
            Self {
                handle,
                instance_id: DIR_INSTANCE_NONCE.fetch_add(1, Ordering::Relaxed),
            }
        }

        /// Opens `root_dir` as the anchor directory handle.
        ///
        /// Uses [`OpenOptions`] so Rust's standard Windows path handling
        /// transparently supports extended-length (`> MAX_PATH`) project roots.
        ///
        /// # Errors
        ///
        /// Returns an error when `root_dir` cannot be opened as a directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            let root_dir = super::normalize_anchor_root(root_dir);
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
            Ok(Self::from_handle(handle))
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
                current = Self::from_handle(next);
            }
            Ok(Some(current))
        }

        /// Opens a direct existing child directory named `segment` without
        /// following symlinks or junctions.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `segment` is invalid or
        /// refers to a reparse point, or [`ContainedFsError::Io`] on OS errors.
        pub fn open_existing_child_dir(
            &self,
            segment: &OsStr,
        ) -> Result<Option<Self>, ContainedFsError> {
            validate_dir_segment(segment)?;
            let next = match nt_create_relative(
                self.handle.as_raw_handle(),
                segment,
                FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE,
                FILE_ATTRIBUTE_DIRECTORY,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                std::ptr::null_mut(),
            ) {
                Ok(handle) => handle,
                Err(status) if is_not_found_status(status) => return Ok(None),
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
            Ok(Some(Self::from_handle(next)))
        }

        /// Returns the 128-bit on-disk identity of this directory itself via
        /// `GetFileInformationByHandleEx(FileIdInfo)`, or `None` when the
        /// volume does not expose full 128-bit file IDs.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Io`] on OS errors.
        pub fn self_identity(&self) -> Result<Option<FileIdentity>, ContainedFsError> {
            handle_file_identity(self.handle.as_raw_handle())
        }

        /// Detects the filename equivalence policy of this Windows directory,
        /// respecting NTFS per-directory case sensitivity.
        ///
        /// Returns `None` when the filesystem does not support
        /// `FileCaseSensitiveInformation` (for example, case-sensitive SMB
        /// shares) so callers can fall back to actual entry identities or
        /// filesystem probing rather than assuming case-insensitivity.
        #[must_use]
        pub fn filename_equivalence(&self) -> Option<super::DirFilenameEquivalence> {
            let mut iosb = IoStatusBlock {
                status_or_pointer: 0,
                information: 0,
            };
            let mut info = FileCaseSensitiveInformation { flags: 0 };
            // SAFETY: `self.handle` is open and `info` is valid for its size.
            let status = unsafe {
                NtQueryInformationFile(
                    self.handle.as_raw_handle(),
                    &mut iosb,
                    (&mut info as *mut FileCaseSensitiveInformation).cast::<c_void>(),
                    u32::try_from(std::mem::size_of::<FileCaseSensitiveInformation>()).unwrap_or(0),
                    FILE_CASE_SENSITIVE_INFORMATION_CLASS,
                )
            };
            if status >= 0 {
                if (info.flags & FILE_CS_FLAG_CASE_SENSITIVE_DIR) != 0 {
                    Some(super::DirFilenameEquivalence::Exact)
                } else {
                    Some(super::DirFilenameEquivalence::CaseInsensitiveNtfs)
                }
            } else {
                None
            }
        }

        /// Read-only filename equivalence check that inspects only already-existing
        /// entries in `self` without mutating the directory.
        #[must_use]
        pub fn probe_existing_names_equivalent(&self, left: &OsStr, right: &OsStr) -> Option<bool> {
            if left == right {
                return Some(true);
            }
            if validate_single_file_name(left).is_err() || validate_single_file_name(right).is_err()
            {
                return None;
            }
            match (self.file_identity(left), self.file_identity(right)) {
                (Ok(Some(left_id)), Ok(Some(right_id))) => Some(left_id == right_id),
                (Ok(Some(_)), Ok(None)) | (Ok(None), Ok(Some(_))) => Some(false),
                _ => None,
            }
        }

        /// Probes whether two single-segment filenames resolve to the same
        /// entry on this Windows directory's mounted filesystem.
        ///
        /// First compares actual on-disk file identities when either entry
        /// already exists (working even on read-only directories). Otherwise
        /// creates a temporary delete-on-close subdirectory inside `self` and
        /// checks whether creating `left` makes `right` resolve to the same
        /// file identity.
        #[must_use]
        pub fn probe_names_equivalent(&self, left: &OsStr, right: &OsStr) -> Option<bool> {
            if let Some(result) = self.probe_existing_names_equivalent(left, right) {
                return Some(result);
            }
            if validate_single_file_name(left).is_err() || validate_single_file_name(right).is_err()
            {
                return None;
            }
            let pid = std::process::id();
            let probe_dir_handle = {
                let mut created = None;
                for _ in 0..32 {
                    let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                    let probe_name = OsString::from(format!(".pmds-probe-{pid}-{nonce}"));
                    match nt_create_relative(
                        self.handle.as_raw_handle(),
                        &probe_name,
                        FILE_READ_ATTRIBUTES | FILE_TRAVERSE | DELETE | SYNCHRONIZE,
                        FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_HIDDEN,
                        0,
                        FILE_CREATE,
                        FILE_DIRECTORY_FILE
                            | FILE_OPEN_REPARSE_POINT
                            | FILE_SYNCHRONOUS_IO_NONALERT,
                        std::ptr::null_mut(),
                    ) {
                        Ok(handle) => {
                            created = Some(handle);
                            break;
                        }
                        Err(STATUS_OBJECT_NAME_COLLISION) => continue,
                        Err(_) => return None,
                    }
                }
                created?
            };
            struct WindowsProbeDirCleanup {
                handle: OwnedHandle,
            }
            impl Drop for WindowsProbeDirCleanup {
                fn drop(&mut self) {
                    let _ = nt_mark_delete_on_close(self.handle.as_raw_handle());
                }
            }
            let probe_dir = WindowsProbeDirCleanup {
                handle: probe_dir_handle,
            };
            let left_handle = nt_create_relative(
                probe_dir.handle.as_raw_handle(),
                left,
                FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
                FILE_ATTRIBUTE_TEMPORARY,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_CREATE,
                FILE_NON_DIRECTORY_FILE
                    | FILE_OPEN_REPARSE_POINT
                    | FILE_DELETE_ON_CLOSE
                    | FILE_SYNCHRONOUS_IO_NONALERT,
                std::ptr::null_mut(),
            )
            .ok()?;
            let left_id = handle_file_identity(left_handle.as_raw_handle())
                .ok()
                .flatten()?;
            let result = match nt_create_relative(
                probe_dir.handle.as_raw_handle(),
                right,
                FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                std::ptr::null_mut(),
            ) {
                Ok(right_handle) => {
                    let right_id = handle_file_identity(right_handle.as_raw_handle())
                        .ok()
                        .flatten()?;
                    Some(left_id == right_id)
                }
                Err(status) if is_not_found_status(status) => Some(false),
                Err(_) => None,
            };
            // Drop `left_handle` first so `FILE_DELETE_ON_CLOSE` empties
            // `probe_dir` before `probe_dir`'s drop marks it delete-on-close.
            drop(left_handle);
            drop(probe_dir);
            result
        }

        /// Detects whether filenames in this directory are compared
        /// case-insensitively, respecting NTFS per-directory case sensitivity.
        #[must_use]
        pub fn is_case_insensitive(&self) -> Option<bool> {
            self.filename_equivalence()
                .map(|eq| eq != super::DirFilenameEquivalence::Exact)
        }

        /// Windows filesystems preserve Unicode normalization forms as distinct
        /// filenames.
        #[must_use]
        pub fn is_unicode_normalizing(&self) -> Option<bool> {
            Some(false)
        }

        /// Returns the canonical filesystem-identity lock key for `file_name`
        /// in this directory, used to deduplicate and order multi-target locks.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// or [`ContainedFsError::Io`] on OS errors.
        pub fn target_lock_key(
            &self,
            file_name: &OsStr,
        ) -> Result<super::TargetLockKey, ContainedFsError> {
            validate_single_file_name(file_name)?;
            // Coordinate directory-wide (matching Unix) when 128-bit `FileIdInfo`
            // is available so NTFS 8.3 short-name aliases, case variants, and
            // ReFS directories serialize under one unambiguous lock key. When
            // the volume does not expose full 128-bit IDs, key by this handle's
            // unique instance ID so distinct directories never collide as
            // reentrant while same-handle nested calls still reenter safely.
            match self.self_identity()? {
                Some(dir_id) => Ok(super::TargetLockKey {
                    dir_id: Some(dir_id),
                    target_hash: 0,
                }),
                None => Ok(super::TargetLockKey {
                    dir_id: None,
                    target_hash: self.instance_id,
                }),
            }
        }

        /// Acquires an exclusive cross-process, cross-session, and cross-thread
        /// lock covering read-modify-write operations on `file_name` in this
        /// directory.
        ///
        /// Uses create-only (`FILE_CREATE`) acquisition of a directory-wide
        /// `.pmds-lock` file with atomic `FILE_DELETE_ON_CLOSE` and
        /// `share_access = 0` inside this directory so writers across all logon
        /// sessions (interactive, RDP, Windows services, SMB shares) and across
        /// NTFS 8.3 short/long filename aliases coordinate cleanly without ever
        /// modifying or deleting a pre-existing unowned file and without
        /// leaving lock files behind on normal drop or crash. Re-entrant on the
        /// same thread; the OS lock remains held until the last live guard
        /// drops.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// or [`ContainedFsError::Io`] on OS lock failures or pre-existing
        /// unowned lock-name collisions.
        pub fn lock_target(
            &self,
            file_name: &OsStr,
        ) -> Result<ContainedTargetLock, ContainedFsError> {
            let key = self.target_lock_key(file_name)?;
            if let Some(existing) = HELD_WINDOWS_LOCKS
                .with(|held| held.borrow().get(&key).and_then(std::rc::Weak::upgrade))
            {
                return Ok(ContainedTargetLock { _lock: existing });
            }

            let lock_name = OsStr::new(WINDOWS_DIR_LOCK_NAME);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            let mut backoff_ms: u64 = 2;
            let handle = loop {
                match nt_create_relative(
                    self.handle.as_raw_handle(),
                    lock_name,
                    FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
                    FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_TEMPORARY,
                    0,
                    FILE_CREATE,
                    FILE_NON_DIRECTORY_FILE
                        | FILE_OPEN_REPARSE_POINT
                        | FILE_DELETE_ON_CLOSE
                        | FILE_SYNCHRONOUS_IO_NONALERT,
                    std::ptr::null_mut(),
                ) {
                    Ok(handle) => {
                        // Stamp the shared Palamedes lock signature so Unix
                        // clients on the same SMB share also recognize this
                        // lock file if the connection drops abruptly. Propagate
                        // any I/O error so the delete-on-close handle cleans up
                        // instead of proceeding with an unstamped lock.
                        let mut file = File::from(handle);
                        io::Write::write_all(&mut file, super::DIR_LOCK_MAGIC)?;
                        file.flush()?;
                        break OwnedHandle::from(file);
                    }
                    Err(STATUS_SHARING_VIOLATION | STATUS_DELETE_PENDING) => {
                        if std::time::Instant::now() >= deadline {
                            return Err(ContainedFsError::Io(io::Error::new(
                                io::ErrorKind::TimedOut,
                                format!(
                                    "timed out waiting for exclusive catalog lock for \"{}\"",
                                    file_name.to_string_lossy()
                                ),
                            )));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
                        backoff_ms = (backoff_ms * 2).min(50);
                    }
                    Err(STATUS_OBJECT_NAME_COLLISION) => {
                        // Distinguish an active exclusive lock holder, an
                        // abandoned Palamedes lock (for example left by a
                        // crashed Unix SMB writer), and an unrelated user file.
                        match nt_create_relative(
                            self.handle.as_raw_handle(),
                            lock_name,
                            FILE_READ_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE,
                            FILE_ATTRIBUTE_NORMAL,
                            0,
                            FILE_OPEN,
                            FILE_NON_DIRECTORY_FILE
                                | FILE_OPEN_REPARSE_POINT
                                | FILE_SYNCHRONOUS_IO_NONALERT,
                            std::ptr::null_mut(),
                        ) {
                            Err(STATUS_SHARING_VIOLATION | STATUS_DELETE_PENDING) => {
                                if std::time::Instant::now() >= deadline {
                                    return Err(ContainedFsError::Io(io::Error::new(
                                        io::ErrorKind::TimedOut,
                                        format!(
                                            "timed out waiting for exclusive catalog lock for \"{}\"",
                                            file_name.to_string_lossy()
                                        ),
                                    )));
                                }
                                std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
                                backoff_ms = (backoff_ms * 2).min(50);
                            }
                            Err(status) if is_not_found_status(status) => continue,
                            Ok(existing_handle) => {
                                let is_abandoned_lock =
                                    file_information(existing_handle.as_raw_handle())
                                        .ok()
                                        .is_some_and(|info| {
                                            (info.file_attributes
                                                & (FILE_ATTRIBUTE_DIRECTORY
                                                    | FILE_ATTRIBUTE_REPARSE_POINT))
                                                == 0
                                                && info.number_of_links == 1
                                                && info.file_size_high == 0
                                                && usize::try_from(info.file_size_low).ok()
                                                    == Some(super::DIR_LOCK_MAGIC.len())
                                        });
                                let mut existing_file = File::from(existing_handle);
                                if is_abandoned_lock {
                                    let mut magic = [0_u8; super::DIR_LOCK_MAGIC.len()];
                                    match io::Read::read_exact(&mut existing_file, &mut magic) {
                                        Ok(()) if magic == super::DIR_LOCK_MAGIC => {
                                            if nt_mark_delete_on_close(
                                                existing_file.as_raw_handle(),
                                            )
                                            .is_ok()
                                            {
                                                drop(existing_file);
                                                continue;
                                            }
                                        }
                                        Err(err) if err.raw_os_error() == Some(33) => {
                                            // ERROR_LOCK_VIOLATION: active SMB byte-range lock.
                                            drop(existing_file);
                                            if std::time::Instant::now() >= deadline {
                                                return Err(ContainedFsError::Io(io::Error::new(
                                                    io::ErrorKind::TimedOut,
                                                    format!(
                                                        "timed out waiting for exclusive catalog lock for \"{}\"",
                                                        file_name.to_string_lossy()
                                                    ),
                                                )));
                                            }
                                            std::thread::sleep(std::time::Duration::from_millis(
                                                backoff_ms,
                                            ));
                                            backoff_ms = (backoff_ms * 2).min(50);
                                            continue;
                                        }
                                        _ => {}
                                    }
                                }
                                return Err(ContainedFsError::Io(io::Error::new(
                                    io::ErrorKind::AlreadyExists,
                                    format!(
                                        "refusing to overwrite or delete pre-existing entry \"{}\"",
                                        lock_name.to_string_lossy()
                                    ),
                                )));
                            }
                            Err(_) => {
                                return Err(ContainedFsError::Io(io::Error::new(
                                    io::ErrorKind::AlreadyExists,
                                    format!(
                                        "refusing to overwrite or delete pre-existing entry \"{}\"",
                                        lock_name.to_string_lossy()
                                    ),
                                )));
                            }
                        }
                    }
                    Err(status) => {
                        return Err(ContainedFsError::Io(nt_status_to_io_error(status)));
                    }
                }
            };
            let lock = std::rc::Rc::new(WindowsDirTargetLock {
                key,
                _handle: handle,
            });
            HELD_WINDOWS_LOCKS.with(|held| {
                held.borrow_mut().insert(key, std::rc::Rc::downgrade(&lock));
            });
            Ok(ContainedTargetLock { _lock: lock })
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

        /// Rejects `file_name` if it exists as a symlink/reparse point or a
        /// multi-link hard link (`number_of_links > 1`).
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// refers to a reparse point, or has multiple hard links.
        pub fn reject_symlink_or_hard_link(
            &self,
            file_name: &OsStr,
        ) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let handle = match nt_create_relative(
                self.handle.as_raw_handle(),
                file_name,
                FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                FILE_ATTRIBUTE_NORMAL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                FILE_OPEN,
                FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                std::ptr::null_mut(),
            ) {
                Ok(handle) => handle,
                Err(status) if is_not_found_status(status) => return Ok(()),
                Err(status) => return Err(ContainedFsError::Io(nt_status_to_io_error(status))),
            };
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
            Ok(())
        }

        /// Returns `true` if `file_name` exists in this directory (and is not a
        /// symlink/reparse point), or `false` if it does not exist.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid
        /// or refers to a symlink/reparse point.
        pub fn entry_exists(&self, file_name: &OsStr) -> Result<bool, ContainedFsError> {
            validate_single_file_name(file_name)?;
            Ok(self.inspect_entry(file_name, false)?.is_some())
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
                .and_then(|(identity, _)| identity))
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

        /// Writes `bytes` to `file_name` through this verified Windows
        /// directory handle without following reparse points, overwriting
        /// hard-linked files, or truncating an existing file object in place.
        ///
        /// Rejects reserved lock filenames, reparse points, and existing
        /// hard-linked targets (`number_of_links > 1`), then publishes a
        /// replacement file atomically so concurrent hard links to the
        /// previous file cannot be mutated while preserving DACL/owner
        /// metadata.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid,
        /// reserved, refers to a reparse point, or has multiple hard links, or
        /// [`ContainedFsError::Io`] on OS errors.
        pub fn write_file_in_place(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> Result<(), ContainedFsError> {
            super::validate_writable_file_name(file_name)?;
            self.reject_symlink_or_hard_link(file_name)?;
            let _target_lock = self.lock_target(file_name)?;
            if let Some((expected_identity, existing_security)) =
                self.inspect_entry(file_name, true)?
            {
                let has_security_descriptors = existing_security.as_ref().is_some_and(|security| {
                    security.owner_sd.is_some()
                        || security.group_sd.is_some()
                        || security.dacl_sd.is_some()
                        || security.label_sd.is_some()
                });
                let can_atomic_replace = existing_security.as_ref().is_none_or(|security| {
                    (!has_security_descriptors || security.sacl_accessible)
                        && !security.is_encrypted
                        && !security.has_named_streams
                        && !security.has_extended_attributes
                        && (security.file_attributes & UNPRESERVABLE_STORAGE_ATTRIBUTES) == 0
                });
                if !can_atomic_replace {
                    if matches!(
                        self.try_overwrite_existing_transacted(
                            file_name,
                            expected_identity,
                            bytes,
                            ContainedWriteDurability::Rename,
                        )?,
                        TransactedOverwriteOutcome::Committed
                    ) {
                        return Ok(());
                    }
                    return self
                        .overwrite_existing_exclusively(
                            file_name,
                            expected_identity,
                            bytes,
                            ContainedWriteDurability::Rename,
                        )
                        .map(|_| ());
                }
            }
            self.write_file_atomically(
                file_name,
                bytes,
                ContainedNewFileMode::RespectUmask,
                ContainedWriteDurability::Rename,
            )
            .map(|_| ())
        }

        /// Atomically writes `bytes` to `file_name` inside this directory
        /// handle, verifying write access on any existing file and preserving
        /// its owner, DACL, security labels/attributes, audit SACL,
        /// compression, and basic attributes.
        ///
        /// When the destination carries metadata that cannot be copied across a
        /// temp-file rename (such as an audit SACL without `SeSecurityPrivilege`,
        /// NTFS named data streams, or special NTFS storage attributes), opens
        /// the verified existing single-link file inside a local KTM/TxF
        /// transaction so updates remain both crash-atomic and metadata-preserving.
        /// Fails closed before modifying the destination when neither
        /// temp-file replacement nor NTFS TxF can guarantee both properties.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is a
        /// symlink/reparse point or hard-linked target during transacted
        /// update, or [`ContainedFsError::Io`] on OS errors.
        pub fn write_file_atomically(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
            _new_file_mode: ContainedNewFileMode,
            durability: ContainedWriteDurability,
        ) -> Result<ContainedWriteOutcome, ContainedFsError> {
            super::validate_writable_file_name(file_name)?;
            let _target_lock = self.lock_target(file_name)?;
            for _ in 0..8 {
                let existing_entry = self.inspect_entry(file_name, true)?;
                let target_existed = existing_entry.is_some();
                let existing_identity = existing_entry.as_ref().and_then(|(identity, _)| *identity);
                let mut existing_security = existing_entry.and_then(|(_, security)| security);
                let has_security_descriptors = existing_security.as_ref().is_some_and(|security| {
                    security.owner_sd.is_some()
                        || security.group_sd.is_some()
                        || security.dacl_sd.is_some()
                        || security.label_sd.is_some()
                });
                let needs_transacted_update = existing_security.as_ref().is_some_and(|security| {
                    (has_security_descriptors && !security.sacl_accessible)
                        || security.is_encrypted
                        || security.has_named_streams
                        || security.has_extended_attributes
                        || (security.file_attributes & UNPRESERVABLE_STORAGE_ATTRIBUTES) != 0
                });
                if target_existed && needs_transacted_update {
                    match self.try_overwrite_existing_transacted(
                        file_name,
                        existing_identity,
                        bytes,
                        durability,
                    )? {
                        TransactedOverwriteOutcome::Committed => {
                            return Ok(ContainedWriteOutcome::Committed);
                        }
                        TransactedOverwriteOutcome::Unsupported => {
                            let reason = if existing_security
                                .as_ref()
                                .is_some_and(|security| security.is_encrypted)
                            {
                                "cannot safely preserve Windows EFS encryption recipients across atomic replacement"
                            } else if existing_security
                                .as_ref()
                                .is_some_and(|security| security.has_named_streams)
                            {
                                "cannot safely preserve Windows NTFS named data streams across atomic replacement"
                            } else if existing_security
                                .as_ref()
                                .is_some_and(|security| security.has_extended_attributes)
                            {
                                "cannot safely preserve Windows NTFS extended attributes across atomic replacement"
                            } else if existing_security.as_ref().is_some_and(|security| {
                                (security.file_attributes & UNPRESERVABLE_STORAGE_ATTRIBUTES) != 0
                            }) {
                                "cannot safely preserve per-file Windows NTFS storage attributes across atomic replacement"
                            } else {
                                "cannot atomically replace existing Windows file without SeSecurityPrivilege or NTFS TxF because audit SACL preservation cannot be guaranteed"
                            };
                            return Err(ContainedFsError::Io(io::Error::new(
                                io::ErrorKind::Unsupported,
                                reason,
                            )));
                        }
                    }
                }
                let initial_dacl = existing_security
                    .as_mut()
                    .and_then(|sec| sec.dacl_sd.as_mut())
                    .map_or(std::ptr::null_mut(), |buffer| {
                        buffer.as_mut_ptr().cast::<c_void>()
                    });
                let initial_attributes = existing_security
                    .as_ref()
                    .map(|sec| sec.file_attributes & PRESERVED_BASIC_ATTRIBUTES)
                    .filter(|&attrs| attrs != 0)
                    .unwrap_or(FILE_ATTRIBUTE_NORMAL);
                let preserving_sacl = existing_security
                    .as_ref()
                    .is_some_and(|sec| sec.sacl_sd.is_some());

                let mut temp_guard = WindowsTempFileGuard::new(self.create_temp_file(
                    initial_dacl,
                    initial_attributes,
                    existing_security.is_some(),
                    preserving_sacl,
                )?);
                if let Some(existing_security) = existing_security.as_ref() {
                    restore_and_verify_windows_attributes(
                        temp_guard.file.as_raw_handle(),
                        existing_security.file_attributes,
                    )?;
                }
                temp_guard.file.write_all(bytes)?;
                temp_guard.file.flush()?;
                if let Some(existing_security) = existing_security.as_mut() {
                    if let Some(owner_sd) = existing_security.owner_sd.as_mut() {
                        restore_windows_owner(temp_guard.file.as_raw_handle(), owner_sd)?;
                    }
                    if let Some(group_sd) = existing_security.group_sd.as_mut() {
                        restore_windows_group(temp_guard.file.as_raw_handle(), group_sd)?;
                    }
                    if let Some(dacl_sd) = existing_security.dacl_sd.as_mut() {
                        restore_and_verify_windows_dacl(temp_guard.file.as_raw_handle(), dacl_sd)?;
                    }
                    if let Some(label_sd) = existing_security.label_sd.as_mut() {
                        restore_and_verify_windows_sacl_info(
                            temp_guard.file.as_raw_handle(),
                            LABEL_SECURITY_INFORMATION,
                            label_sd,
                        )?;
                    }
                    if let Some(attribute_sd) = existing_security.attribute_sd.as_mut() {
                        restore_and_verify_windows_sacl_info(
                            temp_guard.file.as_raw_handle(),
                            ATTRIBUTE_SECURITY_INFORMATION,
                            attribute_sd,
                        )?;
                    }
                    if let Some(scope_sd) = existing_security.scope_sd.as_mut() {
                        restore_and_verify_windows_sacl_info(
                            temp_guard.file.as_raw_handle(),
                            SCOPE_SECURITY_INFORMATION,
                            scope_sd,
                        )?;
                    }
                    if let Some(sacl_sd) = existing_security.sacl_sd.as_mut() {
                        restore_and_verify_windows_sacl_info(
                            temp_guard.file.as_raw_handle(),
                            SACL_SECURITY_INFORMATION,
                            sacl_sd,
                        )?;
                    }
                }
                if durability.syncs_file() {
                    temp_guard.file.sync_all()?;
                }

                if target_existed {
                    let current = self.inspect_entry(file_name, true)?;
                    let Some((current_identity, mut current_security)) = current else {
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            format!(
                                "destination \"{}\" was removed concurrently before publication",
                                file_name.to_string_lossy()
                            ),
                        )));
                    };
                    if let Some(expected_identity) = existing_identity
                        && current_identity != Some(expected_identity)
                    {
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            format!(
                                "destination \"{}\" was replaced concurrently before publication",
                                file_name.to_string_lossy()
                            ),
                        )));
                    }
                    if !windows_security_matches(
                        existing_security.as_mut(),
                        current_security.as_mut(),
                    )? {
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
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            format!(
                                "destination \"{}\" was created concurrently before publication",
                                file_name.to_string_lossy()
                            ),
                        )));
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
        ) -> Result<Option<(Option<FileIdentity>, Option<ExistingWindowsSecurity>)>, ContainedFsError>
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
                let has_named_streams = has_windows_named_streams(handle.as_raw_handle())?;
                let has_extended_attributes =
                    has_windows_extended_attributes(handle.as_raw_handle())?;
                let owner_sd =
                    read_security_descriptor(handle.as_raw_handle(), OWNER_SECURITY_INFORMATION)?;
                let group_sd =
                    read_security_descriptor(handle.as_raw_handle(), GROUP_SECURITY_INFORMATION)?;
                let dacl_sd =
                    read_security_descriptor(handle.as_raw_handle(), DACL_SECURITY_INFORMATION)?;
                let label_sd =
                    read_security_descriptor(handle.as_raw_handle(), LABEL_SECURITY_INFORMATION)?;
                let attribute_sd = read_security_descriptor(
                    handle.as_raw_handle(),
                    ATTRIBUTE_SECURITY_INFORMATION,
                )?;
                let scope_sd =
                    read_security_descriptor(handle.as_raw_handle(), SCOPE_SECURITY_INFORMATION)?;
                let (sacl_accessible, sacl_sd) = match nt_create_relative(
                    self.handle.as_raw_handle(),
                    file_name,
                    ACCESS_SYSTEM_SECURITY | SYNCHRONIZE,
                    FILE_ATTRIBUTE_NORMAL,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    FILE_OPEN,
                    FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                    std::ptr::null_mut(),
                ) {
                    Ok(sacl_handle) => (
                        true,
                        read_security_descriptor(
                            sacl_handle.as_raw_handle(),
                            SACL_SECURITY_INFORMATION,
                        )?,
                    ),
                    Err(STATUS_PRIVILEGE_NOT_HELD | STATUS_ACCESS_DENIED) => (false, None),
                    Err(status) => {
                        return Err(ContainedFsError::Io(nt_status_to_io_error(status)));
                    }
                };
                Some(ExistingWindowsSecurity {
                    owner_sd,
                    group_sd,
                    dacl_sd,
                    label_sd,
                    sacl_sd,
                    sacl_accessible,
                    attribute_sd,
                    scope_sd,
                    file_attributes: info.file_attributes,
                    is_encrypted,
                    has_named_streams,
                    has_extended_attributes,
                })
            } else {
                None
            };
            let identity = handle_file_identity(handle.as_raw_handle())?;
            Ok(Some((identity, security)))
        }

        fn try_overwrite_existing_transacted(
            &self,
            file_name: &OsStr,
            expected_identity: Option<FileIdentity>,
            bytes: &[u8],
            durability: ContainedWriteDurability,
        ) -> Result<TransactedOverwriteOutcome, ContainedFsError> {
            let Some(api) = load_windows_txf_api() else {
                return Ok(TransactedOverwriteOutcome::Unsupported);
            };
            // SAFETY: `api.create_transaction` is a valid KTM entry point; null
            // optional parameters create a default local transaction.
            let raw_tx = unsafe {
                (api.create_transaction)(
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    std::ptr::null_mut(),
                )
            };
            if raw_tx.is_null() || raw_tx == INVALID_HANDLE_VALUE {
                return Ok(TransactedOverwriteOutcome::Unsupported);
            }
            // SAFETY: `CreateTransaction` returned a newly owned kernel handle.
            let mut tx_guard = TransactionGuard {
                handle: unsafe { OwnedHandle::from_raw_handle(raw_tx) },
                rollback: api.rollback_transaction,
                committed: false,
            };

            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            let mut backoff_ms: u64 = 2;
            let handle = loop {
                // SAFETY: `rtl_get_current_transaction` and
                // `rtl_set_current_transaction` are valid ntdll entry points.
                let previous_tx = unsafe { (api.rtl_get_current_transaction)() };
                let bound =
                    unsafe { (api.rtl_set_current_transaction)(tx_guard.handle.as_raw_handle()) };
                if bound == 0 {
                    return Ok(TransactedOverwriteOutcome::Unsupported);
                }
                let _thread_tx = ThreadTransactionGuard {
                    previous: previous_tx,
                    set_tx: api.rtl_set_current_transaction,
                };
                let open_result = nt_create_relative(
                    self.handle.as_raw_handle(),
                    file_name,
                    FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                    FILE_ATTRIBUTE_NORMAL,
                    FILE_SHARE_READ,
                    FILE_OPEN,
                    FILE_NON_DIRECTORY_FILE
                        | FILE_OPEN_REPARSE_POINT
                        | FILE_SYNCHRONOUS_IO_NONALERT,
                    std::ptr::null_mut(),
                );
                drop(_thread_tx);
                match open_result {
                    Ok(handle) => break handle,
                    Err(status) => match super::classify_windows_txf_open_status(status) {
                        super::WindowsTxfOpenDisposition::NotFound => {
                            return Err(ContainedFsError::Io(io::Error::new(
                                io::ErrorKind::AlreadyExists,
                                format!(
                                    "destination \"{}\" was removed concurrently before update",
                                    file_name.to_string_lossy()
                                ),
                            )));
                        }
                        super::WindowsTxfOpenDisposition::Retry => {
                            if std::time::Instant::now() >= deadline {
                                return Err(ContainedFsError::Io(nt_status_to_io_error(status)));
                            }
                            std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
                            backoff_ms = (backoff_ms * 2).min(50);
                        }
                        super::WindowsTxfOpenDisposition::Unsupported => {
                            return Ok(TransactedOverwriteOutcome::Unsupported);
                        }
                        super::WindowsTxfOpenDisposition::Error => {
                            return Err(ContainedFsError::Io(nt_status_to_io_error(status)));
                        }
                    },
                }
            };

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
            let live_identity = handle_file_identity(handle.as_raw_handle())?;
            if let Some(expected_identity) = expected_identity
                && live_identity != Some(expected_identity)
            {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!(
                        "destination \"{}\" was replaced concurrently before update",
                        file_name.to_string_lossy()
                    ),
                )));
            }

            let mut file = File::from(handle);
            file.set_len(0)?;
            file.write_all(bytes)?;
            file.flush()?;
            if durability.syncs_file() {
                file.sync_all()?;
            }
            drop(file);

            // SAFETY: `tx_guard.handle` is a valid open KTM transaction handle
            // and all transacted file handles have been closed.
            if unsafe { (api.commit_transaction)(tx_guard.handle.as_raw_handle()) } == 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            tx_guard.committed = true;
            Ok(TransactedOverwriteOutcome::Committed)
        }

        fn overwrite_existing_exclusively(
            &self,
            file_name: &OsStr,
            expected_identity: Option<FileIdentity>,
            bytes: &[u8],
            durability: ContainedWriteDurability,
        ) -> Result<ContainedWriteOutcome, ContainedFsError> {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            let mut backoff_ms: u64 = 2;
            let handle = loop {
                match nt_create_relative(
                    self.handle.as_raw_handle(),
                    file_name,
                    FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                    FILE_ATTRIBUTE_NORMAL,
                    0,
                    FILE_OPEN,
                    FILE_NON_DIRECTORY_FILE
                        | FILE_OPEN_REPARSE_POINT
                        | FILE_SYNCHRONOUS_IO_NONALERT,
                    std::ptr::null_mut(),
                ) {
                    Ok(handle) => break handle,
                    Err(status) if is_not_found_status(status) => {
                        return Err(ContainedFsError::Io(io::Error::new(
                            io::ErrorKind::AlreadyExists,
                            format!(
                                "destination \"{}\" was removed concurrently before update",
                                file_name.to_string_lossy()
                            ),
                        )));
                    }
                    Err(STATUS_SHARING_VIOLATION) => {
                        if std::time::Instant::now() >= deadline {
                            return Err(ContainedFsError::Io(nt_status_to_io_error(
                                STATUS_SHARING_VIOLATION,
                            )));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
                        backoff_ms = (backoff_ms * 2).min(50);
                    }
                    Err(status) => {
                        return Err(ContainedFsError::Io(nt_status_to_io_error(status)));
                    }
                }
            };
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
            let live_identity = handle_file_identity(handle.as_raw_handle())?;
            if let Some(expected_identity) = expected_identity
                && live_identity != Some(expected_identity)
            {
                return Err(ContainedFsError::Io(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!(
                        "destination \"{}\" was replaced concurrently before update",
                        file_name.to_string_lossy()
                    ),
                )));
            }
            let mut file = File::from(handle);
            file.set_len(0)?;
            file.write_all(bytes)?;
            file.flush()?;
            if durability.syncs_file() {
                file.sync_all()?;
            }
            Ok(ContainedWriteOutcome::Committed)
        }

        fn create_temp_file(
            &self,
            security_descriptor: *mut c_void,
            file_attributes: u32,
            preserving_security: bool,
            preserving_sacl: bool,
        ) -> Result<File, ContainedFsError> {
            let mut desired_access = if preserving_security {
                GENERIC_WRITE
                    | FILE_READ_DATA
                    | FILE_READ_ATTRIBUTES
                    | FILE_WRITE_ATTRIBUTES
                    | READ_CONTROL
                    | WRITE_DAC
                    | WRITE_OWNER
                    | DELETE
                    | SYNCHRONIZE
            } else {
                GENERIC_WRITE | DELETE | SYNCHRONIZE
            };
            if preserving_sacl {
                desired_access |= ACCESS_SYSTEM_SECURITY;
            }
            let pid = std::process::id();
            for _ in 0..128 {
                let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                let name = OsString::from(format!(".pmds-tmp-{pid}-{nonce}"));
                match nt_create_relative(
                    self.handle.as_raw_handle(),
                    &name,
                    desired_access,
                    file_attributes,
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
        const ERROR_INVALID_PARAMETER: i32 = 87;
        if matches!(
            error.raw_os_error(),
            Some(ERROR_INVALID_FUNCTION | ERROR_NOT_SUPPORTED)
        ) || (matches!(
            requested_information,
            ATTRIBUTE_SECURITY_INFORMATION | SCOPE_SECURITY_INFORMATION
        ) && error.raw_os_error() == Some(ERROR_INVALID_PARAMETER))
        {
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
            let mut verified_sd = read_security_descriptor(temp_handle, OWNER_SECURITY_INFORMATION)
                .map_err(ContainedFsError::into_io_error)?;
            if !windows_owner_matches(existing_sd, verified_sd.as_deref_mut())? {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "cannot verify original Windows file owner preservation on replacement",
                ));
            }
        }
        Ok(())
    }

    fn restore_windows_group(
        temp_handle: *mut c_void,
        existing_sd: &mut [usize],
    ) -> io::Result<()> {
        let mut existing_group: *mut c_void = std::ptr::null_mut();
        let mut defaulted: i32 = 0;
        // SAFETY: `existing_sd` is a valid security descriptor returned by `GetKernelObjectSecurity`.
        if unsafe {
            GetSecurityDescriptorGroup(
                existing_sd.as_mut_ptr().cast::<c_void>(),
                &mut existing_group,
                &mut defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if existing_group.is_null() {
            return Ok(());
        }
        let mut temp_group_sd = read_security_descriptor(temp_handle, GROUP_SECURITY_INFORMATION)
            .map_err(ContainedFsError::into_io_error)?;
        if !windows_group_matches(existing_sd, temp_group_sd.as_deref_mut())? {
            // SAFETY: `temp_handle` was opened with `WRITE_OWNER` and `existing_sd` contains the group SID.
            if unsafe {
                SetKernelObjectSecurity(
                    temp_handle,
                    GROUP_SECURITY_INFORMATION,
                    existing_sd.as_mut_ptr().cast::<c_void>(),
                )
            } == 0
            {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "cannot preserve original Windows primary group on replacement: {error}"
                    ),
                ));
            }
            let mut verified_sd = read_security_descriptor(temp_handle, GROUP_SECURITY_INFORMATION)
                .map_err(ContainedFsError::into_io_error)?;
            if !windows_group_matches(existing_sd, verified_sd.as_deref_mut())? {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "cannot verify original Windows primary group preservation on replacement",
                ));
            }
        }
        Ok(())
    }

    fn windows_group_matches(
        expected_sd: &mut [usize],
        actual_sd: Option<&mut [usize]>,
    ) -> io::Result<bool> {
        let mut expected_group: *mut c_void = std::ptr::null_mut();
        let mut expected_defaulted: i32 = 0;
        // SAFETY: `expected_sd` is a valid security descriptor.
        if unsafe {
            GetSecurityDescriptorGroup(
                expected_sd.as_mut_ptr().cast::<c_void>(),
                &mut expected_group,
                &mut expected_defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let Some(actual_sd) = actual_sd else {
            return Ok(expected_group.is_null());
        };
        let mut actual_group: *mut c_void = std::ptr::null_mut();
        let mut actual_defaulted: i32 = 0;
        // SAFETY: `actual_sd` is a valid security descriptor.
        if unsafe {
            GetSecurityDescriptorGroup(
                actual_sd.as_mut_ptr().cast::<c_void>(),
                &mut actual_group,
                &mut actual_defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if expected_group.is_null() && actual_group.is_null() {
            return Ok(true);
        }
        if expected_group.is_null() || actual_group.is_null() {
            return Ok(false);
        }
        // SAFETY: both SID pointers are non-null and owned by their respective descriptors.
        Ok(unsafe { EqualSid(expected_group, actual_group) } != 0)
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

    fn is_default_ntfs_data_stream(name_utf16: &[u16]) -> bool {
        const DEFAULT_STREAM: &[u8] = b"::$DATA";
        name_utf16.len() == DEFAULT_STREAM.len()
            && name_utf16
                .iter()
                .zip(DEFAULT_STREAM.iter())
                .all(|(&unit, &expected)| {
                    u8::try_from(unit).is_ok_and(|byte| byte.eq_ignore_ascii_case(&expected))
                })
    }

    fn has_windows_extended_attributes(handle: *mut c_void) -> io::Result<bool> {
        let mut iosb = IoStatusBlock {
            status_or_pointer: 0,
            information: 0,
        };
        let mut info = FileEaInformation { ea_size: 0 };
        // SAFETY: `handle` is open and `info` is valid for its size.
        let status = unsafe {
            NtQueryInformationFile(
                handle,
                &mut iosb,
                (&mut info as *mut FileEaInformation).cast::<c_void>(),
                u32::try_from(std::mem::size_of::<FileEaInformation>()).unwrap_or(4),
                FILE_EA_INFORMATION_CLASS,
            )
        };
        if matches!(
            status,
            STATUS_INVALID_DEVICE_REQUEST
                | STATUS_NOT_SUPPORTED
                | STATUS_NOT_IMPLEMENTED
                | STATUS_INVALID_PARAMETER
        ) {
            return Ok(false);
        }
        if status < 0 {
            return Err(nt_status_to_io_error(status));
        }
        Ok(info.ea_size > 0)
    }

    fn has_windows_named_streams(handle: *mut c_void) -> io::Result<bool> {
        let mut buf_bytes = 4096usize;
        let max_bytes = 1024 * 1024;
        loop {
            let word_count = buf_bytes.div_ceil(std::mem::size_of::<u64>());
            let mut buffer = vec![0u64; word_count];
            let byte_len = u32::try_from(buffer.len().saturating_mul(std::mem::size_of::<u64>()))
                .unwrap_or(u32::MAX);
            let mut iosb = IoStatusBlock {
                status_or_pointer: 0,
                information: 0,
            };
            // SAFETY: `handle` is open and `buffer` is 8-byte aligned with `byte_len` bytes.
            let status = unsafe {
                NtQueryInformationFile(
                    handle,
                    &mut iosb,
                    buffer.as_mut_ptr().cast::<c_void>(),
                    byte_len,
                    FILE_STREAM_INFORMATION_CLASS,
                )
            };
            if status == STATUS_BUFFER_OVERFLOW {
                if buf_bytes >= max_bytes {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "cannot inspect Windows NTFS named data streams because stream metadata exceeds buffer limit",
                    ));
                }
                buf_bytes = (buf_bytes * 2).min(max_bytes);
                continue;
            }
            if matches!(
                status,
                STATUS_INVALID_DEVICE_REQUEST
                    | STATUS_NOT_SUPPORTED
                    | STATUS_NOT_IMPLEMENTED
                    | STATUS_INVALID_PARAMETER
            ) {
                return Ok(false);
            }
            if status < 0 {
                return Err(nt_status_to_io_error(status));
            }
            let returned = iosb
                .information
                .min(buffer.len() * std::mem::size_of::<u64>());
            if returned == 0 {
                return Ok(false);
            }
            let base = buffer.as_ptr().cast::<u8>();
            let name_offset = std::mem::offset_of!(FileStreamInformation, stream_name);
            let mut offset = 0usize;
            while offset + name_offset <= returned {
                // SAFETY: `offset` is within `returned` and each entry is
                // naturally aligned by NT's `FILE_STREAM_INFORMATION` layout.
                let entry_ptr = unsafe { base.add(offset).cast::<FileStreamInformation>() };
                let next_entry_offset =
                    unsafe { std::ptr::addr_of!((*entry_ptr).next_entry_offset).read_unaligned() };
                let stream_name_length =
                    unsafe { std::ptr::addr_of!((*entry_ptr).stream_name_length).read_unaligned() };
                let name_bytes = usize::try_from(stream_name_length).unwrap_or(0);
                if offset + name_offset + name_bytes > returned {
                    break;
                }
                let unit_count = name_bytes / 2;
                let mut units = Vec::with_capacity(unit_count);
                for idx in 0..unit_count {
                    // SAFETY: bounded by `offset + name_offset + name_bytes <= returned`.
                    let unit = unsafe {
                        base.add(offset + name_offset + idx * 2)
                            .cast::<u16>()
                            .read_unaligned()
                    };
                    units.push(unit);
                }
                if !is_default_ntfs_data_stream(&units) {
                    return Ok(true);
                }
                if next_entry_offset == 0 {
                    break;
                }
                let step = usize::try_from(next_entry_offset).unwrap_or(0);
                if step == 0 || offset.saturating_add(step) <= offset {
                    break;
                }
                offset += step;
            }
            return Ok(false);
        }
    }

    fn extract_windows_sacl(sd: &mut [usize]) -> io::Result<(bool, bool, Option<&[u8]>)> {
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
        let mut sacl_present: i32 = 0;
        let mut sacl_ptr: *mut c_void = std::ptr::null_mut();
        let mut sacl_defaulted: i32 = 0;
        // SAFETY: `sd` is a valid security descriptor returned by `GetKernelObjectSecurity`.
        if unsafe {
            GetSecurityDescriptorSacl(
                sd.as_mut_ptr().cast::<c_void>(),
                &mut sacl_present,
                &mut sacl_ptr,
                &mut sacl_defaulted,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let protected = (control & SE_SACL_PROTECTED) != 0;
        if sacl_present == 0 {
            return Ok((protected, false, None));
        }
        if sacl_ptr.is_null() {
            return Ok((protected, true, None));
        }
        // SAFETY: `sacl_ptr` points to a valid Windows `ACL` header inside `sd`.
        let header = unsafe { &*sacl_ptr.cast::<AclHeader>() };
        let acl_size = usize::from(header.acl_size);
        // SAFETY: `acl_size` bytes starting at `sacl_ptr` belong to the valid ACL inside `sd`.
        let bytes = unsafe { std::slice::from_raw_parts(sacl_ptr.cast::<u8>(), acl_size) };
        Ok((protected, true, Some(bytes)))
    }

    fn windows_sacl_matches(
        expected_sd: &mut [usize],
        actual_sd: Option<&mut [usize]>,
    ) -> io::Result<bool> {
        let Some(actual_sd) = actual_sd else {
            return Ok(false);
        };
        let expected = extract_windows_sacl(expected_sd)?;
        let actual = extract_windows_sacl(actual_sd)?;
        Ok(expected == actual)
    }

    fn optional_sacl_matches(
        expected: Option<&mut [usize]>,
        actual: Option<&mut [usize]>,
    ) -> io::Result<bool> {
        match (expected, actual) {
            (None, None) => Ok(true),
            (Some(exp_sd), act_sd) => windows_sacl_matches(exp_sd, act_sd),
            (None, Some(_)) => Ok(false),
        }
    }

    fn restore_and_verify_windows_sacl_info(
        temp_handle: *mut c_void,
        security_information: u32,
        existing_sd: &mut [usize],
    ) -> io::Result<()> {
        let mut current_sd = read_security_descriptor(temp_handle, security_information)
            .map_err(ContainedFsError::into_io_error)?;
        if windows_sacl_matches(existing_sd, current_sd.as_deref_mut())? {
            return Ok(());
        }
        // SAFETY: `temp_handle` is open with the required security access and
        // `existing_sd` is a valid security descriptor.
        if unsafe {
            SetKernelObjectSecurity(
                temp_handle,
                security_information,
                existing_sd.as_mut_ptr().cast::<c_void>(),
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "cannot preserve original Windows security label/SACL on replacement: {error}"
                ),
            ));
        }
        let mut verified_sd = read_security_descriptor(temp_handle, security_information)
            .map_err(ContainedFsError::into_io_error)?;
        if !windows_sacl_matches(existing_sd, verified_sd.as_deref_mut())? {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "cannot verify exact Windows security label/SACL preservation on replacement",
            ));
        }
        Ok(())
    }

    fn restore_and_verify_windows_attributes(
        temp_handle: *mut c_void,
        existing_attributes: u32,
    ) -> io::Result<()> {
        let mut temp_info =
            file_information(temp_handle).map_err(ContainedFsError::into_io_error)?;
        if (existing_attributes & UNPRESERVABLE_STORAGE_ATTRIBUTES)
            != (temp_info.file_attributes & UNPRESERVABLE_STORAGE_ATTRIBUTES)
        {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "cannot safely preserve per-file Windows NTFS storage attributes across atomic replacement",
            ));
        }

        let desired_compressed = (existing_attributes & FILE_ATTRIBUTE_COMPRESSED) != 0;
        let current_compressed = (temp_info.file_attributes & FILE_ATTRIBUTE_COMPRESSED) != 0;
        if desired_compressed != current_compressed {
            let mut format = if desired_compressed {
                COMPRESSION_FORMAT_DEFAULT
            } else {
                COMPRESSION_FORMAT_NONE
            };
            let mut returned: u32 = 0;
            // SAFETY: `temp_handle` is open with read/write access and `format` is a valid u16.
            let ok = unsafe {
                DeviceIoControl(
                    temp_handle,
                    FSCTL_SET_COMPRESSION,
                    (&mut format as *mut u16).cast::<c_void>(),
                    u32::try_from(std::mem::size_of::<u16>()).unwrap_or(2),
                    std::ptr::null_mut(),
                    0,
                    &mut returned,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                let error = io::Error::last_os_error();
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    format!(
                        "cannot safely preserve Windows NTFS compression state on replacement: {error}"
                    ),
                ));
            }
            temp_info = file_information(temp_handle).map_err(ContainedFsError::into_io_error)?;
            if ((temp_info.file_attributes & FILE_ATTRIBUTE_COMPRESSED) != 0) != desired_compressed
            {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "cannot verify Windows NTFS compression state preservation on replacement",
                ));
            }
        }

        let desired_basic = existing_attributes & PRESERVED_BASIC_ATTRIBUTES;
        let current_basic = temp_info.file_attributes & PRESERVED_BASIC_ATTRIBUTES;
        if desired_basic != current_basic {
            let mut basic = FileBasicInformation {
                creation_time: 0,
                last_access_time: 0,
                last_write_time: 0,
                change_time: 0,
                file_attributes: if desired_basic == 0 {
                    FILE_ATTRIBUTE_NORMAL
                } else {
                    desired_basic
                },
                _padding: 0,
            };
            let mut iosb = IoStatusBlock {
                status_or_pointer: 0,
                information: 0,
            };
            // SAFETY: `temp_handle` is open with `FILE_WRITE_ATTRIBUTES` and `basic` is valid.
            let status = unsafe {
                NtSetInformationFile(
                    temp_handle,
                    &mut iosb,
                    (&mut basic as *mut FileBasicInformation).cast::<c_void>(),
                    u32::try_from(std::mem::size_of::<FileBasicInformation>()).unwrap_or(40),
                    FILE_BASIC_INFORMATION_CLASS,
                )
            };
            if status < 0 {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    format!(
                        "cannot safely preserve per-file Windows attributes on replacement: {}",
                        nt_status_to_io_error(status)
                    ),
                ));
            }
            temp_info = file_information(temp_handle).map_err(ContainedFsError::into_io_error)?;
            if (temp_info.file_attributes & PRESERVED_BASIC_ATTRIBUTES) != desired_basic {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "cannot verify per-file Windows attribute preservation on replacement",
                ));
            }
        }
        Ok(())
    }

    fn windows_security_matches(
        expected: Option<&mut ExistingWindowsSecurity>,
        actual: Option<&mut ExistingWindowsSecurity>,
    ) -> io::Result<bool> {
        match (expected, actual) {
            (None, None) => Ok(true),
            (Some(exp), Some(act)) => {
                if exp.is_encrypted != act.is_encrypted
                    || exp.has_named_streams != act.has_named_streams
                    || exp.has_extended_attributes != act.has_extended_attributes
                    || exp.sacl_accessible != act.sacl_accessible
                    || exp.file_attributes != act.file_attributes
                {
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
                let groups_equal = match (exp.group_sd.as_deref_mut(), act.group_sd.as_deref_mut())
                {
                    (None, None) => true,
                    (Some(exp_group), act_group) => windows_group_matches(exp_group, act_group)?,
                    (None, Some(_)) => false,
                };
                if !groups_equal {
                    return Ok(false);
                }
                let dacl_equal = match (exp.dacl_sd.as_deref_mut(), act.dacl_sd.as_deref_mut()) {
                    (None, None) => true,
                    (Some(exp_dacl), act_dacl) => windows_dacl_matches(exp_dacl, act_dacl)?,
                    (None, Some(_)) => false,
                };
                if !dacl_equal {
                    return Ok(false);
                }
                if !optional_sacl_matches(exp.label_sd.as_deref_mut(), act.label_sd.as_deref_mut())?
                {
                    return Ok(false);
                }
                if !optional_sacl_matches(
                    exp.attribute_sd.as_deref_mut(),
                    act.attribute_sd.as_deref_mut(),
                )? {
                    return Ok(false);
                }
                if !optional_sacl_matches(exp.scope_sd.as_deref_mut(), act.scope_sd.as_deref_mut())?
                {
                    return Ok(false);
                }
                optional_sacl_matches(exp.sacl_sd.as_deref_mut(), act.sacl_sd.as_deref_mut())
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

    fn handle_file_identity(handle: *mut c_void) -> Result<Option<FileIdentity>, ContainedFsError> {
        let mut id_info = std::mem::MaybeUninit::<FileIdInfo>::zeroed();
        // SAFETY: `handle` is open and `id_info` is valid for `size_of::<FileIdInfo>()` bytes.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FILE_ID_INFO_CLASS,
                id_info.as_mut_ptr().cast::<c_void>(),
                u32::try_from(std::mem::size_of::<FileIdInfo>()).unwrap_or(24),
            )
        };
        if ok == 0 {
            let error = io::Error::last_os_error();
            const ERROR_INVALID_PARAMETER: i32 = 87;
            if matches!(
                error.raw_os_error(),
                Some(ERROR_INVALID_FUNCTION | ERROR_NOT_SUPPORTED | ERROR_INVALID_PARAMETER)
            ) {
                return Ok(None);
            }
            return Err(ContainedFsError::Io(error));
        }
        // SAFETY: `GetFileInformationByHandleEx(FileIdInfo)` succeeded and initialized `id_info`.
        let id_info = unsafe { id_info.assume_init() };
        if id_info.volume_serial_number == 0 && id_info.file_id == [0u8; 16] {
            return Ok(None);
        }
        Ok(Some(FileIdentity {
            volume_serial: id_info.volume_serial_number,
            file_id: id_info.file_id,
        }))
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

    use std::marker::PhantomData;
    use std::rc::Rc;

    use super::{
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, ContainedWriteOutcome,
        DirFilenameEquivalence, FileIdentity, TargetLockKey, validate_dir_segment,
        validate_relative_dir_segments, validate_single_file_name,
    };

    /// Target lock guard fallback for platforms without Unix/Windows locking.
    #[derive(Debug)]
    pub struct ContainedTargetLock {
        _not_send: PhantomData<Rc<()>>,
    }

    /// Verified directory handle fallback for platforms without Unix/Windows APIs.
    #[derive(Debug)]
    pub struct ContainedDir {
        dir: PathBuf,
    }

    impl ContainedDir {
        /// Opens `root_dir` as the anchor directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            let root_dir = super::normalize_anchor_root(root_dir);
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
            let root_dir = super::normalize_anchor_root(root_dir);
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

        /// Opens a direct existing child directory named `segment` without
        /// following symlinks.
        pub fn open_existing_child_dir(
            &self,
            segment: &OsStr,
        ) -> Result<Option<Self>, ContainedFsError> {
            validate_dir_segment(segment)?;
            let next = self.dir.join(segment);
            match fs::symlink_metadata(&next) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(ContainedFsError::Containment(format!(
                        "refusing to follow symlink at directory component \"{}\"",
                        segment.to_string_lossy()
                    )));
                }
                Ok(metadata) if !metadata.is_dir() => {
                    return Err(ContainedFsError::Io(io::Error::new(
                        io::ErrorKind::NotADirectory,
                        format!("\"{}\" is not a directory", segment.to_string_lossy()),
                    )));
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(ContainedFsError::Io(error)),
            }
            let canonical = fs::canonicalize(&next)?;
            if !canonical.starts_with(&self.dir) {
                return Err(ContainedFsError::Containment(format!(
                    "directory {} escapes parent directory {}",
                    next.display(),
                    self.dir.display()
                )));
            }
            Ok(Some(Self { dir: canonical }))
        }

        /// Unsupported directory identity lookup fallback.
        pub fn self_identity(&self) -> Result<Option<FileIdentity>, ContainedFsError> {
            Ok(None)
        }

        /// Unsupported directory filename-equivalence lookup fallback.
        #[must_use]
        pub fn filename_equivalence(&self) -> Option<DirFilenameEquivalence> {
            None
        }

        /// Read-only filename-equivalence probe fallback.
        #[must_use]
        pub fn probe_existing_names_equivalent(&self, left: &OsStr, right: &OsStr) -> Option<bool> {
            if left == right {
                return Some(true);
            }
            None
        }

        /// Unsupported directory filename-equivalence probe fallback.
        #[must_use]
        pub fn probe_names_equivalent(&self, left: &OsStr, right: &OsStr) -> Option<bool> {
            if left == right {
                return Some(true);
            }
            None
        }

        /// Unsupported directory case-sensitivity lookup fallback.
        #[must_use]
        pub fn is_case_insensitive(&self) -> Option<bool> {
            None
        }

        /// Unsupported directory Unicode-normalization lookup fallback.
        #[must_use]
        pub fn is_unicode_normalizing(&self) -> Option<bool> {
            None
        }

        /// Fallback lock key for platforms without Unix/Windows identities.
        pub fn target_lock_key(
            &self,
            file_name: &OsStr,
        ) -> Result<TargetLockKey, ContainedFsError> {
            validate_single_file_name(file_name)?;
            Ok(TargetLockKey {
                dir_id: FileIdentity { _unsupported: () },
                target_hash: 0,
            })
        }

        /// No-op target lock fallback for platforms without Unix/Windows locking.
        pub fn lock_target(
            &self,
            file_name: &OsStr,
        ) -> Result<ContainedTargetLock, ContainedFsError> {
            validate_single_file_name(file_name)?;
            Ok(ContainedTargetLock {
                _not_send: PhantomData,
            })
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

        /// Rejects `file_name` if it exists as a symlink (hard-link count is
        /// unavailable on fallback targets).
        pub fn reject_symlink_or_hard_link(
            &self,
            file_name: &OsStr,
        ) -> Result<(), ContainedFsError> {
            self.reject_symlink(file_name)
        }

        /// Returns `true` if `file_name` exists in this directory (and is not a
        /// symlink), or `false` if it does not exist.
        pub fn entry_exists(&self, file_name: &OsStr) -> Result<bool, ContainedFsError> {
            validate_single_file_name(file_name)?;
            let path = self.dir.join(file_name);
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    Err(ContainedFsError::Containment(format!(
                        "refusing to write through symlink \"{}\"",
                        file_name.to_string_lossy()
                    )))
                }
                Ok(_) => Ok(true),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
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

        /// Writes `bytes` to `file_name` after verifying containment and
        /// rejecting reserved lock filenames.
        pub fn write_file_in_place(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> Result<(), ContainedFsError> {
            super::validate_writable_file_name(file_name)?;
            self.write_file_atomically(
                file_name,
                bytes,
                ContainedNewFileMode::RespectUmask,
                ContainedWriteDurability::Rename,
            )
            .map(|_| ())
        }

        /// Atomically writes `bytes` to `file_name`.
        pub fn write_file_atomically(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
            _new_file_mode: ContainedNewFileMode,
            durability: ContainedWriteDurability,
        ) -> Result<ContainedWriteOutcome, ContainedFsError> {
            super::validate_writable_file_name(file_name)?;
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

pub use platform::{ContainedDir, ContainedTargetLock};

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

    #[cfg(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd"
    ))]
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

    #[cfg(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "netbsd"
    ))]
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
        dir.write_file_in_place(OsStr::new("fresh-inplace.mjs"), b"fresh-inplace")
            .expect("initial in-place creation succeeds");
        let fresh_inplace = root.path().join("fresh-inplace.mjs");
        assert_eq!(
            fs::read_to_string(&fresh_inplace).expect("read fresh inplace"),
            "fresh-inplace"
        );
        let actual_inplace_acl = read_macos_acl_native_bytes(&fresh_inplace).expect(
            "newly created in-place file must preserve destination directory file_inherit ACL",
        );
        assert_eq!(actual_inplace_acl, expected_acl);

        for (file_name, mode) in [
            ("fresh-atomic-private.po", ContainedNewFileMode::Private),
            ("fresh-atomic-umask.po", ContainedNewFileMode::RespectUmask),
        ] {
            dir.write_file_atomically(
                OsStr::new(file_name),
                b"fresh-atomic",
                mode,
                ContainedWriteDurability::Rename,
            )
            .expect("initial atomic creation succeeds");
            let fresh_atomic = root.path().join(file_name);
            assert_eq!(
                fs::read_to_string(&fresh_atomic).expect("read fresh atomic"),
                "fresh-atomic"
            );
            let actual_atomic_acl = read_macos_acl_native_bytes(&fresh_atomic).expect(
                "newly created atomic file must preserve destination directory file_inherit ACL",
            );
            assert_eq!(actual_atomic_acl, expected_acl);
        }
    }

    #[test]
    fn open_existing_child_dir_and_case_insensitivity_probe_work() {
        let root = tempfile::tempdir().expect("temp dir");
        let child_path = root.path().join("locales");
        fs::create_dir(&child_path).expect("create child dir");
        fs::write(child_path.join("Sample.po"), "hello").expect("seed entry");

        let root_dir = ContainedDir::open_root(root.path()).expect("open root");
        let root_id = root_dir.self_identity().expect("root identity");
        let child_dir = root_dir
            .open_existing_child_dir(OsStr::new("locales"))
            .expect("open child")
            .expect("child exists");
        let child_id = child_dir.self_identity().expect("child identity");
        assert!(
            root_dir
                .open_existing_child_dir(OsStr::new("missing"))
                .expect("missing lookup")
                .is_none()
        );
        // Trailing separators and `/.` suffixes must be rejected before `openat`
        // so symlinked child names can never become intermediate components.
        let outside = tempfile::tempdir().expect("outside dir");
        std::os::unix::fs::symlink(outside.path(), root.path().join("escape"))
            .expect("create symlink");
        for bad_name in ["escape", "escape/", "escape/.", "locales/", "locales/."] {
            assert!(
                matches!(
                    root_dir.open_existing_child_dir(OsStr::new(bad_name)),
                    Err(ContainedFsError::Containment(_))
                ),
                "expected Containment error for {bad_name:?}"
            );
        }
        #[cfg(any(unix, windows))]
        {
            let root_id = root_id.expect("platform identity");
            let child_id = child_id.expect("platform identity");
            assert_ne!(root_id, child_id);
            assert!(root_id.same_volume(child_id));
            let expected_ci = child_dir
                .file_identity(OsStr::new("sample.po"))
                .expect("identity probe")
                == child_dir
                    .file_identity(OsStr::new("Sample.po"))
                    .expect("identity probe");
            assert_eq!(child_dir.is_case_insensitive(), Some(expected_ci));
            #[cfg(target_os = "macos")]
            assert_eq!(child_dir.is_unicode_normalizing(), Some(true));
        }
    }

    #[test]
    fn refuses_staged_replacement_in_non_sticky_shared_writable_parent_and_allows_sticky() {
        let root = tempfile::tempdir().expect("temp dir");
        let shared = root.path().join("shared");
        fs::create_dir(&shared).expect("create shared dir");
        let target = shared.join("en.po");
        fs::write(&target, "before").expect("seed target");

        // Non-sticky group/world-writable directory: staging must fail closed.
        fs::set_permissions(&shared, fs::Permissions::from_mode(0o777)).expect("chmod 0777");
        let dir = ContainedDir::open_root(&shared).expect("open shared dir");
        let error = dir
            .write_file_atomically(
                OsStr::new("en.po"),
                b"after",
                ContainedNewFileMode::Private,
                ContainedWriteDurability::Rename,
            )
            .expect_err("non-sticky shared writable dir must fail closed");
        assert!(
            matches!(&error, ContainedFsError::Io(io_err) if io_err.kind() == io::ErrorKind::PermissionDenied),
            "expected PermissionDenied, got {error}"
        );
        assert_eq!(
            fs::read_to_string(&target).expect("read unchanged"),
            "before"
        );

        // Adding the sticky bit protects staging entries against foreign replacement.
        fs::set_permissions(&shared, fs::Permissions::from_mode(0o1777)).expect("chmod 1777");
        dir.write_file_atomically(
            OsStr::new("en.po"),
            b"after",
            ContainedNewFileMode::Private,
            ContainedWriteDurability::Rename,
        )
        .expect("sticky shared writable dir owned by caller should succeed");
        assert_eq!(fs::read_to_string(&target).expect("read updated"), "after");

        fs::set_permissions(&shared, fs::Permissions::from_mode(0o755)).expect("restore");
    }

    #[test]
    fn open_subpath_creates_stageable_directories_and_serializes_concurrent_updates() {
        use std::sync::Arc;
        use std::thread;

        let root = tempfile::tempdir().expect("temp dir");
        let leaf = ContainedDir::open_subpath(root.path(), Path::new("nested/locales"), true)
            .expect("create nested catalog dirs")
            .expect("directory opened");
        let leaf_mode = fs::metadata(root.path().join("nested/locales"))
            .expect("stat leaf")
            .permissions()
            .mode();
        assert_eq!(
            leaf_mode & 0o0022,
            0,
            "newly created catalog directory must not be group/world-writable"
        );
        leaf.write_file_atomically(
            OsStr::new("counter.po"),
            b"0",
            ContainedNewFileMode::Private,
            ContainedWriteDurability::Rename,
        )
        .expect("initial write in newly created directory");

        let root_path = Arc::new(root.path().to_path_buf());
        let mut handles = Vec::new();
        for _ in 0..4 {
            let root_path = Arc::clone(&root_path);
            handles.push(thread::spawn(move || {
                let dir =
                    ContainedDir::open_subpath(&root_path, Path::new("nested/locales"), false)
                        .expect("open leaf")
                        .expect("exists");
                for _ in 0..5 {
                    let _lock = dir
                        .lock_target(OsStr::new("counter.po"))
                        .expect("acquire target lock");
                    let current: usize = dir
                        .read_optional_file(OsStr::new("counter.po"))
                        .expect("read counter")
                        .expect("counter exists")
                        .trim()
                        .parse()
                        .expect("numeric counter");
                    let next = (current + 1).to_string();
                    dir.write_file_atomically(
                        OsStr::new("counter.po"),
                        next.as_bytes(),
                        ContainedNewFileMode::Private,
                        ContainedWriteDurability::Rename,
                    )
                    .expect("serialized atomic update");
                }
            }));
        }
        for handle in handles {
            handle.join().expect("worker completed");
        }
        assert_eq!(
            fs::read_to_string(root.path().join("nested/locales/counter.po"))
                .expect("read final counter"),
            "20",
            "cross-thread/process target lock must prevent lost catalog updates"
        );
    }

    #[test]
    fn reentrant_target_lock_keeps_os_lock_until_last_guard_drops() {
        use std::sync::mpsc;
        use std::thread;
        use std::time::Duration;

        let root = tempfile::tempdir().expect("temp dir");
        let dir = ContainedDir::open_root(root.path()).expect("open root");
        let first = dir
            .lock_target(OsStr::new("en.po"))
            .expect("acquire first guard");
        let second = dir
            .lock_target(OsStr::new("en.po"))
            .expect("acquire reentrant second guard");

        // Drop the FIRST guard while the SECOND guard is still alive.
        drop(first);

        let root_path = root.path().to_path_buf();
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || {
            let other_dir = ContainedDir::open_root(&root_path).expect("open root on worker");
            let _lock = other_dir
                .lock_target(OsStr::new("en.po"))
                .expect("worker acquires lock after release");
            tx.send(()).expect("signal acquisition");
        });

        assert!(
            rx.recv_timeout(Duration::from_millis(80)).is_err(),
            "OS lock must remain held while the second reentrant guard is still live"
        );
        drop(second);
        rx.recv_timeout(Duration::from_secs(5))
            .expect("worker must acquire lock once the last reentrant guard drops");
        handle.join().expect("worker joined");
        assert!(
            !root.path().join(".pmds-lock").exists(),
            "Unix lock file must be removed when the final guard drops"
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_target_lock_preserves_preexisting_non_lock_file() {
        for initial in ["user-owned-content", ""] {
            let root = tempfile::tempdir().expect("temp dir");
            let existing = root.path().join(".pmds-lock");
            fs::write(&existing, initial).expect("seed pre-existing file");

            let dir = ContainedDir::open_root(root.path()).expect("open root");
            let error = dir
                .lock_target(OsStr::new("en.po"))
                .expect_err("lock must refuse to overwrite or remove pre-existing non-lock file");
            assert!(
                matches!(&error, ContainedFsError::Io(io_err) if io_err.kind() == io::ErrorKind::AlreadyExists),
                "unexpected error for initial={initial:?}: {error}"
            );
            assert_eq!(
                fs::read_to_string(&existing).expect("pre-existing file must remain intact"),
                initial
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn read_optional_file_rejects_fifo_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let root = tempfile::tempdir().expect("temp dir");
        let fifo_path = root.path().join("en.po");
        let c_fifo = CString::new(fifo_path.as_os_str().as_bytes()).expect("cstr");
        // SAFETY: `c_fifo` is a valid NUL-terminated path inside our temp dir.
        assert_eq!(
            unsafe { libc::mkfifo(c_fifo.as_ptr(), 0o600) },
            0,
            "mkfifo failed: {}",
            io::Error::last_os_error()
        );

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        let error = dir
            .read_optional_file(OsStr::new("en.po"))
            .expect_err("FIFO catalog input must be rejected immediately");
        assert!(
            matches!(error, ContainedFsError::Containment(_)),
            "expected containment error for FIFO, got {error:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_target_lock_recovers_interrupted_temp_link_but_rejects_unrelated_hard_link() {
        let root = tempfile::tempdir().expect("temp dir");
        let lock_path = root.path().join(".pmds-lock");
        let stale_temp = root.path().join(".pmds-ltmp-999999-0");
        fs::write(&lock_path, b"palamedes-dir-lock-v1\n").expect("seed lock");
        fs::hard_link(&lock_path, &stale_temp).expect("simulate interrupted linkat");

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        {
            let _guard = dir
                .lock_target(OsStr::new("en.po"))
                .expect("stale .pmds-ltmp-* hard link must be recovered automatically");
            assert!(
                !stale_temp.exists(),
                "stale interrupted .pmds-ltmp-* link must be removed"
            );
        }
        assert!(
            !lock_path.exists(),
            ".pmds-lock must be removed when recovered lock drops"
        );

        let unrelated = root.path().join("unrelated-user-file.txt");
        fs::write(&lock_path, b"palamedes-dir-lock-v1\n").expect("seed lock");
        fs::hard_link(&lock_path, &unrelated).expect("create unrelated hard link");
        let error = dir
            .lock_target(OsStr::new("en.po"))
            .expect_err("unrelated hard link on .pmds-lock must still be rejected");
        assert!(
            matches!(error, ContainedFsError::Containment(_)),
            "expected containment error for unrelated hard link, got {error:?}"
        );
        assert!(
            unrelated.exists(),
            "unrelated hard-linked user file must never be deleted"
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_target_lock_waits_on_read_only_valid_lock_file_and_empty_root_opens_cwd() {
        let root = tempfile::tempdir().expect("temp dir");
        let lock_path = root.path().join(".pmds-lock");
        fs::write(&lock_path, b"palamedes-dir-lock-v1\n").expect("seed valid lock");
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o444))
            .expect("chmod 0444 lock");

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        {
            let _guard = dir
                .lock_target(OsStr::new("en.po"))
                .expect("read-only valid lock file must be acquirable via O_RDONLY flock fallback");
        }
        assert!(
            !lock_path.exists(),
            "valid lock file should be unlinked on drop when directory permits"
        );

        let cwd_anchor =
            ContainedDir::open_root(Path::new("")).expect("empty root must normalize to '.'");
        let dot_anchor = ContainedDir::open_root(Path::new(".")).expect("open '.'");
        assert_eq!(
            cwd_anchor.self_identity().expect("cwd identity"),
            dot_anchor.self_identity().expect("dot identity")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_owner_only_write_acl_allows_staging_while_foreign_acl_is_rejected() {
        use std::process::Command;

        let root = tempfile::tempdir().expect("temp dir");
        let dir_path = root.path().join("owner-acl");
        fs::create_dir_all(&dir_path).expect("create dir");
        fs::set_permissions(&dir_path, fs::Permissions::from_mode(0o755)).expect("chmod 0755");

        let whoami = Command::new("/usr/bin/id")
            .arg("-un")
            .output()
            .expect("id -un");
        assert!(whoami.status.success());
        let user = String::from_utf8_lossy(&whoami.stdout).trim().to_owned();

        // Grant `add_file` ONLY to the current user; staging must succeed.
        let owner_grant = Command::new("/bin/chmod")
            .args(["+a", &format!("user:{user} allow add_file")])
            .arg(&dir_path)
            .status()
            .expect("chmod +a owner");
        if !owner_grant.success() {
            // Filesystem does not support macOS ACLs.
            return;
        }
        let dir = ContainedDir::open_root(&dir_path).expect("open root");
        dir.write_file_atomically(
            OsStr::new("en.po"),
            b"owner-acl-ok",
            ContainedNewFileMode::RespectUmask,
            ContainedWriteDurability::Rename,
        )
        .expect("caller-only write ACL must not be treated as foreign write access");
        assert_eq!(
            fs::read_to_string(dir_path.join("en.po")).expect("read written catalog"),
            "owner-acl-ok"
        );

        // Now add a foreign write grant (`everyone allow add_file`): non-sticky
        // staging must fail closed.
        let foreign_grant = Command::new("/bin/chmod")
            .args(["+a", "everyone allow add_file"])
            .arg(&dir_path)
            .status()
            .expect("chmod +a everyone");
        if foreign_grant.success() {
            let error = dir
                .write_file_atomically(
                    OsStr::new("de.po"),
                    b"blocked",
                    ContainedNewFileMode::RespectUmask,
                    ContainedWriteDurability::Rename,
                )
                .expect_err("foreign write ACL on non-sticky dir must fail closed");
            assert!(
                matches!(
                    &error,
                    ContainedFsError::Io(io_err) if io_err.kind() == io::ErrorKind::PermissionDenied
                ),
                "expected PermissionDenied error for foreign ACL, got {error:?}"
            );
        }
    }

    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    #[test]
    fn unix_readonly_lock_recovery_reclaims_abandoned_lock_and_waits_for_live_holder() {
        use std::os::fd::{AsRawFd, OwnedFd};

        let root = tempfile::tempdir().expect("temp dir");
        let dir = ContainedDir::open_root(root.path()).expect("open root");
        let lock_path = root.path().join(".pmds-lock");

        // 1. Abandoned read-only `.pmds-lock` with valid magic and no active flock:
        //    must be reclaimed immediately rather than timing out.
        fs::write(&lock_path, super::platform::UNIX_DIR_LOCK_MAGIC).expect("write abandoned lock");
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o444)).expect("chmod 0444");
        let fd = OwnedFd::from(fs::File::open(&lock_path).expect("open read-only lock"));
        let stat = super::platform::fstat_fd(fd.as_raw_fd()).expect("fstat abandoned lock");
        let id = super::platform::stat_identity(&stat);

        let started = std::time::Instant::now();
        super::platform::wait_for_readonly_lock_release(&dir, fd, id)
            .expect("abandoned read-only lock must recover");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(2),
            "abandoned lock recovery must not time out"
        );
        assert!(
            !lock_path.exists(),
            "abandoned .pmds-lock must be unlinked during recovery"
        );
        let leftover_claims: Vec<_> = fs::read_dir(root.path())
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".pmds-claim-")
            })
            .collect();
        assert!(
            leftover_claims.is_empty(),
            "recovery claim file must be cleaned up"
        );

        // 2. Active live writer holding LOCK_EX: must wait until holder unlinks
        //    and releases LOCK_EX cleanly.
        let live_guard = dir.lock_target(OsStr::new("en.po")).expect("live lock");
        let live_ro_fd = OwnedFd::from(fs::File::open(&lock_path).expect("open live lock"));
        let live_stat = super::platform::fstat_fd(live_ro_fd.as_raw_fd()).expect("fstat live lock");
        let live_id = super::platform::stat_identity(&live_stat);

        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let dir_path = root.path().to_path_buf();
        let waiter = std::thread::spawn(move || {
            let waiter_dir = ContainedDir::open_root(&dir_path).expect("waiter open root");
            ready_tx.send(()).expect("signal waiter ready");
            super::platform::wait_for_readonly_lock_release(&waiter_dir, live_ro_fd, live_id)
                .expect("wait for live lock");
            done_tx.send(()).expect("signal waiter done");
        });
        ready_rx.recv().expect("waiter ready");
        assert!(
            matches!(
                done_rx.recv_timeout(std::time::Duration::from_millis(60)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ),
            "waiter must remain blocked while active holder owns LOCK_EX"
        );
        assert!(
            lock_path.exists(),
            "waiter must not unlink active holder's lock"
        );
        drop(live_guard);
        done_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("waiter should wake immediately after holder releases lock");
        waiter.join().expect("waiter join");
        assert!(!lock_path.exists());

        // 3. Foreign locked `.pmds-lock` file must fail immediately with
        //    AlreadyExists rather than blocking on flock.
        fs::write(&lock_path, b"foreign-user-data").expect("write foreign file");
        let foreign_file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&lock_path)
            .expect("open foreign file");
        assert_eq!(
            unsafe { libc::flock(foreign_file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0
        );
        let conflict_started = std::time::Instant::now();
        let error = dir
            .lock_target(OsStr::new("en.po"))
            .expect_err("locked foreign .pmds-lock must fail immediately");
        assert!(
            conflict_started.elapsed() < std::time::Duration::from_secs(2),
            "foreign locked file must not block"
        );
        assert!(
            matches!(
                &error,
                ContainedFsError::Io(io_err) if io_err.kind() == io::ErrorKind::AlreadyExists
            ),
            "expected AlreadyExists for foreign locked file, got {error:?}"
        );
        drop(foreign_file);

        // 4. Stale generation-0 recovery claim left by a crashed claimant must
        //    be superseded cleanly by generation-1 without racing unlinks, and
        //    both `.pmds-lock` and all `.pmds-claim-*` files must be removed.
        let _ = fs::remove_file(&lock_path);
        fs::write(&lock_path, super::platform::UNIX_DIR_LOCK_MAGIC).expect("write abandoned lock");
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o444)).expect("chmod 0444");
        let gen_fd = OwnedFd::from(fs::File::open(&lock_path).expect("open read-only lock"));
        let gen_stat = super::platform::fstat_fd(gen_fd.as_raw_fd()).expect("fstat lock");
        let gen_id = super::platform::stat_identity(&gen_stat);
        let stale_gen0 = root.path().join(format!(".pmds-claim-{}-0", gen_id.ino));
        fs::write(&stale_gen0, super::platform::UNIX_DIR_LOCK_MAGIC)
            .expect("write stale gen0 claim");
        super::platform::wait_for_readonly_lock_release(&dir, gen_fd, gen_id)
            .expect("generation-1 must recover past dead generation-0 claim");
        assert!(!lock_path.exists());
        assert!(!stale_gen0.exists());
        let leftover_claims: Vec<_> = fs::read_dir(root.path())
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".pmds-claim-")
            })
            .collect();
        assert!(leftover_claims.is_empty());

        // 5. Read-only recovery must refuse to unlink `.pmds-lock` if an
        //    unrelated hard link remains after temporary-link cleanup.
        fs::write(&lock_path, super::platform::UNIX_DIR_LOCK_MAGIC).expect("write linked lock");
        let external_link = root.path().join("user-hardlink");
        fs::hard_link(&lock_path, &external_link).expect("hard link");
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o444)).expect("chmod 0444");
        let linked_fd = OwnedFd::from(fs::File::open(&lock_path).expect("open linked lock"));
        let linked_stat = super::platform::fstat_fd(linked_fd.as_raw_fd()).expect("fstat linked");
        let linked_id = super::platform::stat_identity(&linked_stat);
        let linked_err =
            super::platform::wait_for_readonly_lock_release(&dir, linked_fd, linked_id)
                .expect_err("unrelated hard link must block read-only lock recovery");
        assert!(matches!(linked_err, ContainedFsError::Containment(_)));
        assert!(
            lock_path.exists(),
            "hard-linked .pmds-lock must not be unlinked"
        );
        let _ = fs::remove_file(&external_link);
        let _ = fs::remove_file(&lock_path);

        // 6. `probe_names_equivalent` confirms live filesystem equivalence.
        assert_eq!(
            dir.probe_names_equivalent(OsStr::new("alpha.po"), OsStr::new("beta.po")),
            Some(false)
        );
        assert_eq!(
            dir.probe_names_equivalent(OsStr::new("same.po"), OsStr::new("same.po")),
            Some(true)
        );

        // 7. Reserved lock filename (including case/ignorable/trailing-dot
        //    variants) is rejected before acquiring or overwriting `.pmds-lock`.
        for reserved in [
            ".pmds-lock",
            ".PMDS-LOCK",
            ".pmds-lock.",
            ".pmds-\u{200c}lock",
            ".pmd\u{017f}-loc\u{212a}",
        ] {
            let err = dir
                .write_file_atomically(
                    OsStr::new(reserved),
                    b"user-bytes",
                    ContainedNewFileMode::RespectUmask,
                    ContainedWriteDurability::Rename,
                )
                .expect_err("reserved lock filename must be rejected by atomic write");
            assert!(matches!(err, ContainedFsError::Containment(_)));
            let in_place_err = dir
                .write_file_in_place(OsStr::new(reserved), b"user-bytes")
                .expect_err("reserved lock filename must be rejected by in-place write");
            assert!(matches!(in_place_err, ContainedFsError::Containment(_)));
        }
        assert!(!lock_path.exists());
        dir.write_file_atomically(
            OsStr::new("after-reserved.po"),
            b"still-writable",
            ContainedNewFileMode::RespectUmask,
            ContainedWriteDurability::Rename,
        )
        .expect("subsequent catalog writes must still succeed");

        // 8. `lock_target` fails closed in a non-sticky shared writable
        //    directory and succeeds once the sticky bit is set.
        let shared = root.path().join("shared-lock-dir");
        fs::create_dir(&shared).expect("create shared dir");
        fs::set_permissions(&shared, fs::Permissions::from_mode(0o777)).expect("chmod 0777");
        let shared_dir = ContainedDir::open_root(&shared).expect("open shared dir");
        let non_sticky_err = shared_dir
            .lock_target(OsStr::new("en.po"))
            .expect_err("lock_target must fail closed in non-sticky shared writable directory");
        assert!(matches!(
            non_sticky_err,
            ContainedFsError::Io(ref io_err) if io_err.kind() == io::ErrorKind::PermissionDenied
        ));
        fs::set_permissions(&shared, fs::Permissions::from_mode(0o1777)).expect("chmod 1777");
        {
            let _guard = shared_dir
                .lock_target(OsStr::new("en.po"))
                .expect("lock_target should succeed in sticky shared dir owned by caller");
        }
        fs::set_permissions(&shared, fs::Permissions::from_mode(0o755)).expect("restore perms");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn replacing_file_preserves_user_extended_attributes() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let root = tempfile::tempdir().expect("temp dir");
        let file_path = root.path().join("en.mjs");
        fs::write(&file_path, "export default { a: 1 };\n").expect("seed module");
        let c_path = CString::new(file_path.as_os_str().as_bytes()).expect("c path");

        #[cfg(target_os = "macos")]
        let attrs: [(&std::ffi::CStr, &[u8]); 2] = [
            (c"com.example.review", b"approved-v1"),
            (c"com.example.empty", b""),
        ];
        #[cfg(target_os = "linux")]
        let attrs: [(&std::ffi::CStr, &[u8]); 2] = [
            (c"user.palamedes.review", b"approved-v1"),
            (c"user.palamedes.empty", b""),
        ];

        for (name, value) in attrs {
            #[cfg(target_os = "macos")]
            let rc = unsafe {
                libc::setxattr(
                    c_path.as_ptr(),
                    name.as_ptr(),
                    value.as_ptr().cast::<libc::c_void>(),
                    value.len(),
                    0,
                    0,
                )
            };
            #[cfg(target_os = "linux")]
            let rc = unsafe {
                libc::setxattr(
                    c_path.as_ptr(),
                    name.as_ptr(),
                    value.as_ptr().cast::<libc::c_void>(),
                    value.len(),
                    0,
                )
            };
            if rc != 0 {
                let err = io::Error::last_os_error();
                #[cfg(target_os = "macos")]
                let unsupported = matches!(
                    err.raw_os_error(),
                    Some(libc::ENOTSUP | libc::EOPNOTSUPP | libc::ENOSYS)
                );
                #[cfg(target_os = "linux")]
                let unsupported =
                    matches!(err.raw_os_error(), Some(libc::EOPNOTSUPP | libc::ENOSYS));
                if unsupported {
                    // Temp filesystem does not support user xattrs.
                    return;
                }
                panic!("setxattr({name:?}) failed: {err}");
            }
        }

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        dir.write_file_in_place(OsStr::new("en.mjs"), b"export default { a: 2 };\n")
            .expect("recompile module via write_file_in_place");
        assert_eq!(
            fs::read_to_string(&file_path).expect("read updated module"),
            "export default { a: 2 };\n"
        );

        for (name, expected) in attrs {
            let mut buf = [0u8; 64];
            #[cfg(target_os = "macos")]
            let read = unsafe {
                libc::getxattr(
                    c_path.as_ptr(),
                    name.as_ptr(),
                    buf.as_mut_ptr().cast::<libc::c_void>(),
                    buf.len(),
                    0,
                    0,
                )
            };
            #[cfg(target_os = "linux")]
            let read = unsafe {
                libc::getxattr(
                    c_path.as_ptr(),
                    name.as_ptr(),
                    buf.as_mut_ptr().cast::<libc::c_void>(),
                    buf.len(),
                )
            };
            assert!(
                read >= 0,
                "user xattr {name:?} disappeared after replacement: {}",
                io::Error::last_os_error()
            );
            #[allow(clippy::cast_sign_loss)]
            let actual = &buf[..read as usize];
            assert_eq!(actual, expected, "user xattr {name:?} value changed");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn replacing_file_preserves_macos_user_bsd_flags() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let root = tempfile::tempdir().expect("temp dir");
        let file_path = root.path().join("en.mjs");
        fs::write(&file_path, "export default { v: 1 };\n").expect("seed module");
        let c_path = CString::new(file_path.as_os_str().as_bytes()).expect("c path");
        let expected_flags = libc::UF_NODUMP | libc::UF_HIDDEN;
        // SAFETY: `c_path` is a valid NUL-terminated path to our temp file.
        if unsafe { libc::chflags(c_path.as_ptr(), expected_flags) } != 0 {
            let err = io::Error::last_os_error();
            if matches!(
                err.raw_os_error(),
                Some(libc::ENOTSUP | libc::EOPNOTSUPP | libc::ENOSYS)
            ) {
                return;
            }
            panic!("chflags failed: {err}");
        }

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        dir.write_file_in_place(OsStr::new("en.mjs"), b"export default { v: 2 };\n")
            .expect("recompile module with BSD user flags");
        assert_eq!(
            fs::read_to_string(&file_path).expect("read updated module"),
            "export default { v: 2 };\n"
        );

        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: `c_path` and `stat` are valid.
        assert_eq!(
            unsafe { libc::lstat(c_path.as_ptr(), stat.as_mut_ptr()) },
            0
        );
        // SAFETY: `lstat` succeeded.
        let stat = unsafe { stat.assume_init() };
        assert_eq!(
            stat.st_flags & expected_flags,
            expected_flags,
            "user BSD flags (UF_NODUMP | UF_HIDDEN) must be preserved across replacement"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_replacement_aborts_when_extended_attributes_are_unreadable() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::MetadataExt;
        use std::process::Command;

        let root = tempfile::tempdir().expect("temp dir");
        let file_path = root.path().join("en.mjs");
        fs::write(&file_path, "export default { v: 1 };\n").expect("seed module");
        let c_path = CString::new(file_path.as_os_str().as_bytes()).expect("c path");
        let attr_name = c"com.example.review";
        let attr_val = b"must-not-drop";
        // SAFETY: `c_path`, `attr_name`, and `attr_val` are valid.
        if unsafe {
            libc::setxattr(
                c_path.as_ptr(),
                attr_name.as_ptr(),
                attr_val.as_ptr().cast::<libc::c_void>(),
                attr_val.len(),
                0,
                0,
            )
        } != 0
        {
            return;
        }
        let status = Command::new("/bin/chmod")
            .args(["+a", "everyone deny readextattr"])
            .arg(&file_path)
            .status()
            .expect("chmod +a deny readextattr");
        if !status.success() {
            return;
        }

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        let err = dir
            .write_file_atomically(
                OsStr::new("en.mjs"),
                b"export default { v: 2 };\n",
                ContainedNewFileMode::RespectUmask,
                ContainedWriteDurability::Rename,
            )
            .expect_err("atomic replacement must fail closed when xattrs cannot be read");
        assert!(
            matches!(
                &err,
                ContainedFsError::Io(io_err) if io_err.kind() == io::ErrorKind::PermissionDenied
            ),
            "expected PermissionDenied when readextattr is denied, got {err:?}"
        );
        // Meanwhile, `write_file_in_place` updates the existing inode in place,
        // preserving unreadable extended attributes automatically.
        let before_ino = fs::metadata(&file_path).expect("stat before").ino();
        dir.write_file_in_place(OsStr::new("en.mjs"), b"export default { v: 2 };\n")
            .expect("in-place write must preserve existing inode and unreadable xattrs");
        let after_ino = fs::metadata(&file_path).expect("stat after").ino();
        assert_eq!(after_ino, before_ino, "write_file_in_place must keep inode");
        // Remove the deny ACE so we can confirm both the updated content and
        // its original extended attribute remained intact.
        let _ = Command::new("/bin/chmod")
            .args(["-a", "everyone deny readextattr"])
            .arg(&file_path)
            .status();
        assert_eq!(
            fs::read_to_string(&file_path).expect("read updated module"),
            "export default { v: 2 };\n"
        );
        let mut buf = [0u8; 32];
        // SAFETY: `c_path`, `attr_name`, and `buf` are valid.
        let read = unsafe {
            libc::getxattr(
                c_path.as_ptr(),
                attr_name.as_ptr(),
                buf.as_mut_ptr().cast::<libc::c_void>(),
                buf.len(),
                0,
                0,
            )
        };
        assert!(read >= 0, "original xattr must remain intact");
        let len = usize::try_from(read).expect("non-negative xattr length");
        assert_eq!(&buf[..len], attr_val);
    }

    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    #[test]
    fn unix_readonly_lock_recovery_serializes_foreign_uid_sticky_lock_without_deleting_it() {
        use std::os::fd::{AsRawFd, OwnedFd};

        let root = tempfile::tempdir().expect("temp dir");
        let dir = ContainedDir::open_root(root.path()).expect("open root");
        let lock_path = root.path().join(".pmds-lock");
        fs::write(&lock_path, super::platform::UNIX_DIR_LOCK_MAGIC).expect("write foreign lock");
        fs::set_permissions(&lock_path, fs::Permissions::from_mode(0o444)).expect("chmod 0444");

        let eperm_unlink = |_dir_raw: std::os::fd::RawFd| -> io::Result<()> {
            Err(io::Error::from_raw_os_error(libc::EPERM))
        };

        // 1. Writer B (distinct UID in root-owned sticky dir) cannot unlink
        //    `.pmds-lock` (`EPERM`), so it acquires `HeldViaClaim`:
        //    `LOCK_SH` on `.pmds-lock` + `LOCK_EX` on `.pmds-claim-<ino>-0`.
        let b_fd = OwnedFd::from(fs::File::open(&lock_path).expect("open foreign lock"));
        let lock_id = super::platform::stat_identity(
            &super::platform::fstat_fd(b_fd.as_raw_fd()).expect("fstat foreign lock"),
        );
        let outcome = super::platform::wait_for_readonly_lock_release_with_unlink(
            &dir,
            b_fd,
            lock_id,
            eperm_unlink,
        )
        .expect("foreign sticky lock must recover via HeldViaClaim without failing EPERM");
        let super::platform::ReadonlyRecoveryOutcome::HeldViaClaim {
            claim_name,
            claim_id,
            claim_fd,
            existing_fd,
        } = outcome
        else {
            panic!("expected HeldViaClaim when unlinkat returns EPERM");
        };
        assert_eq!(
            claim_name.to_str().expect("utf8"),
            format!(".pmds-claim-{}-0", lock_id.ino)
        );
        assert!(
            lock_path.exists(),
            "foreign .pmds-lock must remain intact when unlinkat is denied"
        );

        // Original owner (UID A) attempting `LOCK_EX` on `.pmds-lock` must be
        // blocked while writer B holds `LOCK_SH` on `existing_fd`.
        let owner_fd = fs::File::open(&lock_path).expect("owner open lock");
        assert_ne!(
            unsafe { libc::flock(owner_fd.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0,
            "original lock owner must be blocked while HeldViaClaim holds LOCK_SH"
        );

        // 2. Concurrent distinct-UID writer C must block on writer B's claim,
        //    then wake immediately and reuse generation 0 when writer B exits
        //    cleanly and unlinks its claim.
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let dir_path = root.path().to_path_buf();
        let lock_path_c = lock_path.clone();
        let writer_c = std::thread::spawn(move || {
            let c_dir = ContainedDir::open_root(&dir_path).expect("open root for C");
            let c_fd = OwnedFd::from(fs::File::open(&lock_path_c).expect("C open lock"));
            ready_tx.send(()).expect("signal C ready");
            let c_outcome = super::platform::wait_for_readonly_lock_release_with_unlink(
                &c_dir,
                c_fd,
                lock_id,
                |_dir_raw| Err(io::Error::from_raw_os_error(libc::EPERM)),
            )
            .expect("writer C acquires HeldViaClaim after B releases");
            let super::platform::ReadonlyRecoveryOutcome::HeldViaClaim {
                claim_name: c_claim_name,
                claim_id: c_claim_id,
                claim_fd: c_claim_fd,
                existing_fd: c_existing_fd,
            } = c_outcome
            else {
                panic!("expected HeldViaClaim for writer C");
            };
            // Clean release of writer C's claim (mirrors `UnixDirLock::drop`).
            let c_claim_str = c_claim_name.to_str().expect("utf8").to_owned();
            if let Ok(st) = super::platform::fstat_fd(c_claim_fd.as_raw_fd())
                && super::platform::stat_identity(&st) == c_claim_id
            {
                let _ = fs::remove_file(dir_path.join(&c_claim_str));
            }
            drop(c_claim_fd);
            drop(c_existing_fd);
            done_tx.send(c_claim_str).expect("signal C done");
        });
        ready_rx.recv().expect("C ready");
        assert!(
            matches!(
                done_rx.recv_timeout(std::time::Duration::from_millis(60)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ),
            "writer C must block while writer B holds HeldViaClaim"
        );

        // Writer B finishes cleanly: unlink its claim before releasing locks.
        let b_claim_path = root.path().join(claim_name.to_str().expect("utf8"));
        assert!(b_claim_path.exists());
        let b_stat = super::platform::fstat_fd(claim_fd.as_raw_fd()).expect("fstat B claim");
        assert_eq!(super::platform::stat_identity(&b_stat), claim_id);
        fs::remove_file(&b_claim_path).expect("B unlinks own claim on drop");
        drop(claim_fd);
        drop(existing_fd);

        let c_claim_used = done_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("writer C must wake once writer B releases HeldViaClaim");
        writer_c.join().expect("join C");
        assert_eq!(
            c_claim_used,
            format!(".pmds-claim-{}-0", lock_id.ino),
            "clean claim release must reuse generation 0 instead of leaking generations"
        );

        // Once both foreign-UID holders exit, original owner UID A can take LOCK_EX.
        assert_eq!(
            unsafe { libc::flock(owner_fd.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0,
            "original owner must be able to acquire LOCK_EX once foreign-UID holders exit"
        );
        drop(owner_fd);

        // 3. If a foreign-UID claimant crashes leaving `.pmds-claim-<ino>-0`
        //    behind, the next foreign-UID writer advances to generation 1.
        let crashed_claim = root.path().join(format!(".pmds-claim-{}-0", lock_id.ino));
        fs::write(&crashed_claim, super::platform::UNIX_DIR_LOCK_MAGIC)
            .expect("seed crashed claim");
        let d_fd = OwnedFd::from(fs::File::open(&lock_path).expect("D open lock"));
        let d_outcome = super::platform::wait_for_readonly_lock_release_with_unlink(
            &dir,
            d_fd,
            lock_id,
            eperm_unlink,
        )
        .expect("writer D must advance past crashed generation-0 claim");
        let super::platform::ReadonlyRecoveryOutcome::HeldViaClaim {
            claim_name: d_claim_name,
            claim_fd: d_claim_fd,
            existing_fd: d_existing_fd,
            ..
        } = d_outcome
        else {
            panic!("expected HeldViaClaim for writer D");
        };
        assert_eq!(
            d_claim_name.to_str().expect("utf8"),
            format!(".pmds-claim-{}-1", lock_id.ino)
        );
        assert!(
            crashed_claim.exists(),
            "earlier generation-0 claim must stay in place while HeldViaClaim holds generation 1"
        );
        // Verify a concurrent distinct-UID writer E blocks behind writer D's
        // generation-1 claim rather than claiming a vacant generation 0.
        let (e_ready_tx, e_ready_rx) = std::sync::mpsc::channel();
        let (e_done_tx, e_done_rx) = std::sync::mpsc::channel();
        let dir_path_e = root.path().to_path_buf();
        let lock_path_e = lock_path;
        let writer_e = std::thread::spawn(move || {
            let e_dir = ContainedDir::open_root(&dir_path_e).expect("open root for E");
            let e_fd = OwnedFd::from(fs::File::open(&lock_path_e).expect("E open lock"));
            e_ready_tx.send(()).expect("signal E ready");
            let e_outcome = super::platform::wait_for_readonly_lock_release_with_unlink(
                &e_dir,
                e_fd,
                lock_id,
                |_dir_raw| Err(io::Error::from_raw_os_error(libc::EPERM)),
            )
            .expect("writer E acquires HeldViaClaim after D releases");
            let super::platform::ReadonlyRecoveryOutcome::HeldViaClaim {
                claim_name: e_claim_name,
                claim_fd: e_claim_fd,
                existing_fd: e_existing_fd,
                ..
            } = e_outcome
            else {
                panic!("expected HeldViaClaim for writer E");
            };
            let e_claim_str = e_claim_name.to_str().expect("utf8").to_owned();
            let _ = fs::remove_file(dir_path_e.join(&e_claim_str));
            drop(e_claim_fd);
            drop(e_existing_fd);
            e_done_tx.send(e_claim_str).expect("signal E done");
        });
        e_ready_rx.recv().expect("E ready");
        assert!(
            matches!(
                e_done_rx.recv_timeout(std::time::Duration::from_millis(60)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ),
            "writer E must block while writer D holds generation 1"
        );
        let _ = fs::remove_file(root.path().join(d_claim_name.to_str().expect("utf8")));
        drop(d_claim_fd);
        drop(d_existing_fd);
        let e_claim_used = e_done_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .expect("writer E must wake once writer D releases generation 1");
        writer_e.join().expect("join E");
        assert_eq!(
            e_claim_used,
            format!(".pmds-claim-{}-1", lock_id.ino),
            "writer E must serialize at generation 1 instead of sneaking into generation 0"
        );
    }

    #[cfg(unix)]
    #[test]
    fn replacing_file_strips_setuid_and_setgid_bits() {
        let root = tempfile::tempdir().expect("temp dir");
        let file_path = root.path().join("en.mjs");
        fs::write(&file_path, "export default { v: 1 };\n").expect("seed module");
        if fs::set_permissions(&file_path, fs::Permissions::from_mode(0o4755)).is_err() {
            // Filesystem or mount (e.g. nosuid) refused setting S_ISUID.
            return;
        }
        let seeded_mode = fs::metadata(&file_path)
            .expect("stat seeded")
            .permissions()
            .mode()
            & 0o7777;
        if (seeded_mode & 0o6000) == 0 {
            return;
        }

        let dir = ContainedDir::open_root(root.path()).expect("open root");
        dir.write_file_atomically(
            OsStr::new("en.mjs"),
            b"export default { v: 2 };\n",
            ContainedNewFileMode::RespectUmask,
            ContainedWriteDurability::Rename,
        )
        .expect("atomically replace module");
        let after_atomic_mode = fs::metadata(&file_path)
            .expect("stat atomically replaced")
            .permissions()
            .mode()
            & 0o7777;
        assert_eq!(
            after_atomic_mode & 0o6000,
            0,
            "S_ISUID and S_ISGID must be cleared on atomic replacement, got 0o{after_atomic_mode:04o}"
        );
        assert_eq!(
            after_atomic_mode & 0o0777,
            0o0755,
            "ordinary permission bits must still be preserved on atomic replacement"
        );

        if fs::set_permissions(&file_path, fs::Permissions::from_mode(0o4755)).is_ok() {
            dir.write_file_in_place(OsStr::new("en.mjs"), b"export default { v: 3 };\n")
                .expect("in-place replace module");
            let after_mode = fs::metadata(&file_path)
                .expect("stat in-place replaced")
                .permissions()
                .mode()
                & 0o7777;
            assert_eq!(
                after_mode & 0o6000,
                0,
                "S_ISUID and S_ISGID must be cleared when replacing file in place, got 0o{after_mode:04o}"
            );
            assert_eq!(
                after_mode & 0o0777,
                0o0755,
                "ordinary permission bits must still be preserved in place"
            );
        }
    }

    #[test]
    fn open_subpath_and_open_existing_child_dir_reject_reserved_lock_directory_names() {
        let root = tempfile::tempdir().expect("temp dir");
        let dir = ContainedDir::open_root(root.path()).expect("open root");
        for reserved in [
            ".pmds-lock",
            ".PMDS-LOCK",
            ".pmds-lock.",
            ".pmds-lock ",
            ".pmds\u{200b}-lock",
            ".pmds-lock.\u{200b}",
            ".pmds-loc\u{212a}",
        ] {
            let err = ContainedDir::open_subpath(root.path(), Path::new(reserved), true)
                .expect_err("open_subpath must reject reserved lock directory name");
            assert!(
                matches!(err, ContainedFsError::Containment(_)),
                "expected Containment error for {reserved:?}, got {err:?}"
            );
            assert!(
                !root.path().join(reserved).exists(),
                "must not create reserved directory {reserved:?}"
            );
            let child_err = dir
                .open_existing_child_dir(OsStr::new(reserved))
                .expect_err("open_existing_child_dir must reject reserved lock directory name");
            assert!(
                matches!(child_err, ContainedFsError::Containment(_)),
                "expected Containment error for child {reserved:?}, got {child_err:?}"
            );
        }
    }
}

#[cfg(test)]
mod cross_platform_tests {
    #[test]
    fn windows_txf_open_status_classification_matches_sdk_codes() {
        use super::{WindowsTxfOpenDisposition, classify_windows_txf_open_status};

        // Verified Windows SDK `ntstatus.h` values for unsupported TxF mounts/files.
        for unsupported in [
            0xC000_0002_u32 as i32, // STATUS_NOT_IMPLEMENTED
            0xC000_0010_u32 as i32, // STATUS_INVALID_DEVICE_REQUEST
            0xC000_00BB_u32 as i32, // STATUS_NOT_SUPPORTED
            0xC019_0005_u32 as i32, // STATUS_RM_NOT_ACTIVE
            0xC019_000A_u32 as i32, // STATUS_TRANSACTIONS_UNSUPPORTED_REMOTE
            0xC019_003E_u32 as i32, // STATUS_EFS_NOT_ALLOWED_IN_TRANSACTION
            0xC019_003F_u32 as i32, // STATUS_TRANSACTIONAL_OPEN_NOT_ALLOWED
        ] {
            assert_eq!(
                classify_windows_txf_open_status(unsupported),
                WindowsTxfOpenDisposition::Unsupported,
                "expected Unsupported for NTSTATUS 0x{:08X}",
                u32::from_ne_bytes(unsupported.to_ne_bytes())
            );
        }
        // Transient conflicts retry.
        for retry in [
            0xC000_0043_u32 as i32, // STATUS_SHARING_VIOLATION
            0xC019_0001_u32 as i32, // STATUS_TRANSACTIONAL_CONFLICT
        ] {
            assert_eq!(
                classify_windows_txf_open_status(retry),
                WindowsTxfOpenDisposition::Retry,
                "expected Retry for NTSTATUS 0x{:08X}",
                u32::from_ne_bytes(retry.to_ne_bytes())
            );
        }
        // Concurrent deletion maps to NotFound.
        for not_found in [
            0xC000_0034_u32 as i32, // STATUS_OBJECT_NAME_NOT_FOUND
            0xC000_003A_u32 as i32, // STATUS_OBJECT_PATH_NOT_FOUND
        ] {
            assert_eq!(
                classify_windows_txf_open_status(not_found),
                WindowsTxfOpenDisposition::NotFound
            );
        }
        // Corruption and permission errors must propagate as hard errors, never fallback.
        for hard_error in [
            0xC019_0006_u32 as i32, // STATUS_RM_METADATA_CORRUPT
            0xC000_0022_u32 as i32, // STATUS_ACCESS_DENIED
            0xC019_0002_u32 as i32, // STATUS_INVALID_TRANSACTION
        ] {
            assert_eq!(
                classify_windows_txf_open_status(hard_error),
                WindowsTxfOpenDisposition::Error,
                "expected Error for NTSTATUS 0x{:08X}",
                u32::from_ne_bytes(hard_error.to_ne_bytes())
            );
        }
    }

    #[test]
    fn linux_security_xattr_classification_separates_access_labels_from_integrity_metadata() {
        use super::{LinuxSecurityXattrKind, classify_linux_security_xattr};

        for label in [
            b"security.selinux".as_slice(),
            b"security.SMACK64".as_slice(),
            b"security.SMACK64EXEC".as_slice(),
            b"security.SMACK64MMAP".as_slice(),
            b"security.SMACK64TRANSMUTE".as_slice(),
            b"security.apparmor".as_slice(),
        ] {
            assert_eq!(
                classify_linux_security_xattr(label),
                LinuxSecurityXattrKind::CopyableAccessLabel,
                "expected CopyableAccessLabel for {}",
                String::from_utf8_lossy(label)
            );
        }
        for unpreservable in [
            b"security.capability".as_slice(),
            b"security.ima".as_slice(),
            b"security.evm".as_slice(),
            b"security.custom_unknown".as_slice(),
        ] {
            assert_eq!(
                classify_linux_security_xattr(unpreservable),
                LinuxSecurityXattrKind::UnpreservableIntegrityOrUnknown,
                "expected UnpreservableIntegrityOrUnknown for {}",
                String::from_utf8_lossy(unpreservable)
            );
        }
    }

    #[test]
    fn bsd_system_extattr_filter_recognizes_acl_attributes_only() {
        use super::is_bsd_acl_system_extattr;

        assert!(is_bsd_acl_system_extattr(b"posix1e.acl_access"));
        assert!(is_bsd_acl_system_extattr(b"posix1e.acl_default"));
        assert!(is_bsd_acl_system_extattr(b"nfs4.acl"));
        assert!(!is_bsd_acl_system_extattr(b"mac_biba"));
        assert!(!is_bsd_acl_system_extattr(b"custom.admin"));
    }

    #[test]
    fn linux_copyable_xattr_classification_preserves_trusted_and_rejects_fs_internal() {
        use super::{LinuxCopyableXattrKind, classify_linux_xattr_for_copy};

        for copyable in [
            b"user.palamedes.review".as_slice(),
            b"trusted.palamedes.managed".as_slice(),
            b"trusted.backup.tag".as_slice(),
        ] {
            assert_eq!(
                classify_linux_xattr_for_copy(copyable),
                LinuxCopyableXattrKind::Copyable,
                "expected Copyable for {}",
                String::from_utf8_lossy(copyable)
            );
        }
        for internal in [
            b"trusted.overlay.opaque".as_slice(),
            b"trusted.overlay.metacopy".as_slice(),
            b"trusted.glusterfs.dht".as_slice(),
            b"trusted.afr.dirty".as_slice(),
            b"trusted.gfid".as_slice(),
            b"trusted.SGI_ACL_FILE".as_slice(),
        ] {
            assert_eq!(
                classify_linux_xattr_for_copy(internal),
                LinuxCopyableXattrKind::UnpreservableTrusted,
                "expected UnpreservableTrusted for {}",
                String::from_utf8_lossy(internal)
            );
        }
        for ignored in [
            b"system.posix_acl_access".as_slice(),
            b"security.selinux".as_slice(),
        ] {
            assert_eq!(
                classify_linux_xattr_for_copy(ignored),
                LinuxCopyableXattrKind::Ignore
            );
        }
    }

    #[test]
    fn linux_fsxattr_snapshot_preserves_allocation_attributes_and_strips_readonly_bits() {
        use super::{
            LINUX_FS_XFLAG_COWEXTSIZE, LINUX_FS_XFLAG_DAX, LINUX_FS_XFLAG_EXTSIZE,
            LINUX_FS_XFLAG_FILESTREAM, LINUX_FS_XFLAG_HASATTR, LINUX_FS_XFLAG_NODEFRAG,
            LINUX_FS_XFLAG_PREALLOC, LINUX_FS_XFLAG_REALTIME, LinuxFsxattrSnapshot,
            merge_linux_fsxattr_for_set, snapshot_from_linux_fsxattr,
        };

        let raw_xflags = LINUX_FS_XFLAG_REALTIME
            | LINUX_FS_XFLAG_PREALLOC
            | LINUX_FS_XFLAG_EXTSIZE
            | LINUX_FS_XFLAG_NODEFRAG
            | LINUX_FS_XFLAG_FILESTREAM
            | LINUX_FS_XFLAG_DAX
            | LINUX_FS_XFLAG_COWEXTSIZE
            | LINUX_FS_XFLAG_HASATTR;
        let snap = snapshot_from_linux_fsxattr(raw_xflags, 65_536, 42, 131_072);
        assert_eq!(
            snap,
            LinuxFsxattrSnapshot {
                xflags: LINUX_FS_XFLAG_REALTIME
                    | LINUX_FS_XFLAG_EXTSIZE
                    | LINUX_FS_XFLAG_NODEFRAG
                    | LINUX_FS_XFLAG_FILESTREAM
                    | LINUX_FS_XFLAG_DAX
                    | LINUX_FS_XFLAG_COWEXTSIZE,
                extsize: 65_536,
                projid: 42,
                cowextsize: 131_072,
            }
        );
        assert!(!snap.is_default());

        // Without EXTSIZE/COWEXTSIZE flags, hint sizes normalize to zero.
        let cleared = snapshot_from_linux_fsxattr(LINUX_FS_XFLAG_HASATTR, 65_536, 0, 131_072);
        assert!(cleared.is_default());

        // Merging preserves unrelated settable flags (e.g. FS_XFLAG_NODUMP = 0x80)
        // while clearing read-only status bits and applying expected allocation fields.
        const FS_XFLAG_NODUMP: u32 = 0x0000_0080;
        let (next_xflags, next_extsize, next_projid, next_cowextsize) = merge_linux_fsxattr_for_set(
            FS_XFLAG_NODUMP | LINUX_FS_XFLAG_HASATTR | LINUX_FS_XFLAG_PREALLOC | LINUX_FS_XFLAG_DAX,
            snap,
        );
        assert_eq!(next_xflags, FS_XFLAG_NODUMP | snap.xflags);
        assert_eq!(
            next_xflags & (LINUX_FS_XFLAG_HASATTR | LINUX_FS_XFLAG_PREALLOC),
            0
        );
        assert_eq!(next_extsize, 65_536);
        assert_eq!(next_projid, 42);
        assert_eq!(next_cowextsize, 131_072);
    }

    #[test]
    fn linux_fs_magic_classification_handles_signed_32bit_statfs_values() {
        use super::{DirFilenameEquivalence, classify_linux_fs_magic, is_linux_smb_magic};

        // Simulate 32-bit glibc Linux where `statfs.f_type` is signed `i32` and
        // high-bit filesystem magic constants are negative before truncating to `u32`.
        let cifs_i32 = 0xff53_4d42_u32 as i32;
        let smb2_i32 = 0xfe53_4d42_u32 as i32;
        let btrfs_i32 = 0x9123_683e_u32 as i32;
        let f2fs_i32 = 0xf2f5_2010_u32 as i32;

        #[allow(clippy::cast_sign_loss)]
        {
            assert!(is_linux_smb_magic(cifs_i32 as u32));
            assert!(is_linux_smb_magic(smb2_i32 as u32));
            assert!(is_linux_smb_magic(0x517b));
            assert!(!is_linux_smb_magic(btrfs_i32 as u32));

            assert_eq!(
                classify_linux_fs_magic(btrfs_i32 as u32, false),
                Some(DirFilenameEquivalence::Exact)
            );
            assert_eq!(
                classify_linux_fs_magic(f2fs_i32 as u32, true),
                Some(DirFilenameEquivalence::Exact)
            );
            assert_eq!(classify_linux_fs_magic(f2fs_i32 as u32, false), None);
        }
    }
}
