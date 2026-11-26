//! Directory-handle-pinned filesystem operations for catalog reads and writes.
//!
//! On Unix, directory traversal, creation, reads, identity checks, and atomic
//! replacements run relative to an open directory file descriptor with
//! `O_NOFOLLOW`.
//!
//! On Windows, every directory along the traversal chain is opened with
//! `FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT` and without
//! `FILE_SHARE_DELETE`, pinning the directory chain against concurrent rename,
//! deletion, or reparse-point redirection for the lifetime of [`ContainedDir`].

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

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
/// Existing files always preserve their previous mode and are populated in a
/// `0600` temporary file before permissions are restored prior to rename, so
/// private files are never exposed during replacement.
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
    /// Sync the temporary file before replacement and sync the containing
    /// directory afterward on Unix.
    Full,
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
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, FileIdentity,
        validate_relative_dir_segments, validate_single_file_name,
    };

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    /// Open handle to a verified directory used for containment-enforcing I/O.
    pub struct ContainedDir {
        fd: OwnedFd,
    }

    impl ContainedDir {
        /// Opens `root_dir` as the anchor directory for contained operations.
        ///
        /// # Errors
        ///
        /// Returns an error when `root_dir` cannot be opened as a directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            let c_path = os_str_to_cstring(root_dir.as_os_str())?;
            // SAFETY: `c_path` is a valid NUL-terminated path string.
            let raw = unsafe {
                libc::open(
                    c_path.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            };
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
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                };
                if next < 0 {
                    let error = io::Error::last_os_error();
                    if !create_missing && error.raw_os_error() == Some(libc::ENOENT) {
                        return Ok(None);
                    }
                    if error.raw_os_error() == Some(libc::ELOOP) {
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
            Ok(self.inspect_entry(file_name)?.map(|(_, identity)| identity))
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
                if error.raw_os_error() == Some(libc::ELOOP) {
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
        /// When replacing an existing file, the temporary file is created as
        /// `0600`, populated, and only then updated to the destination's prior
        /// mode via `fchmod`, so private contents are never readable by other
        /// users during replacement.
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
        ) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let existing_mode = self.inspect_entry(file_name)?.map(|(mode, _)| mode);
            let c_target = os_str_to_cstring(file_name)?;

            let create_mode: libc::c_uint = match (existing_mode, new_file_mode) {
                (None, ContainedNewFileMode::RespectUmask) => 0o666,
                _ => 0o600,
            };
            let (temp_name, mut temp_file) = self.create_temp_file(create_mode)?;
            let write_result = (|| -> io::Result<()> {
                temp_file.write_all(bytes)?;
                temp_file.flush()?;
                if durability == ContainedWriteDurability::Full {
                    temp_file.sync_all()?;
                }
                if let Some(mode) = existing_mode
                    && mode != 0o600
                {
                    // Restore existing file permissions only after the private
                    // temporary file is fully written.
                    // SAFETY: `temp_file` holds an open file descriptor.
                    let rc = unsafe { libc::fchmod(temp_file.as_raw_fd(), mode) };
                    if rc != 0 {
                        return Err(io::Error::last_os_error());
                    }
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
            if durability == ContainedWriteDurability::Full {
                // SAFETY: `self.fd` is an open directory descriptor.
                let rc = unsafe { libc::fsync(self.fd.as_raw_fd()) };
                if rc != 0 {
                    let error = io::Error::last_os_error();
                    if !matches!(
                        error.raw_os_error(),
                        Some(libc::EINVAL | libc::EBADF | libc::EROFS)
                    ) {
                        return Err(ContainedFsError::Io(error));
                    }
                }
            }
            Ok(())
        }

        fn inspect_entry(
            &self,
            file_name: &OsStr,
        ) -> Result<Option<(libc::mode_t, FileIdentity)>, ContainedFsError> {
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
            Ok(Some((stat.st_mode & 0o7777, identity)))
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

    fn os_str_to_cstring(value: &OsStr) -> Result<CString, ContainedFsError> {
        CString::new(value.as_bytes()).map_err(|_| {
            ContainedFsError::Containment("path component contains an interior NUL byte".to_owned())
        })
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::{OsStr, OsString};
    use std::fs::{self, File, OpenOptions};
    use std::io::{self, Read, Write};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::{Path, PathBuf};

    use super::{
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, FileIdentity,
        validate_relative_dir_segments, validate_single_file_name,
    };

    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const OPEN_EXISTING: u32 = 3;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_NAME_NORMALIZED: u32 = 0x0;
    const INVALID_HANDLE_VALUE: *mut std::ffi::c_void = (-1_isize) as *mut std::ffi::c_void;

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

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *mut std::ffi::c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void;
        fn GetFileInformationByHandle(
            file: *mut std::ffi::c_void,
            file_information: *mut ByHandleFileInformation,
        ) -> i32;
        fn GetFinalPathNameByHandleW(
            file: *mut std::ffi::c_void,
            file_path: *mut u16,
            file_path_len: u32,
            flags: u32,
        ) -> u32;
    }

    /// Pinned directory chain on Windows. Holding non-`FILE_SHARE_DELETE`
    /// handles to every ancestor from `root_dir` through `dir` prevents
    /// concurrent rename, deletion, or reparse-point substitution while active.
    pub struct ContainedDir {
        _pinned_handles: Vec<OwnedHandle>,
        dir: PathBuf,
    }

    impl ContainedDir {
        /// Opens and pins `root_dir`.
        ///
        /// # Errors
        ///
        /// Returns an error when `root_dir` cannot be opened as a directory.
        pub fn open_root(root_dir: &Path) -> Result<Self, ContainedFsError> {
            let (handle, final_path) = open_pinned_directory(root_dir, false)?;
            Ok(Self {
                _pinned_handles: vec![handle],
                dir: final_path,
            })
        }

        /// Opens and pins `relative_dir` under `root_dir`, refusing symlinks
        /// and junctions at every component and handling concurrent directory
        /// creation (`AlreadyExists`) cleanly.
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
            let (root_handle, root_final) = open_pinned_directory(root_dir, false)?;
            let mut handles = vec![root_handle];
            let mut current = root_final.clone();

            for segment in segments {
                current.push(&segment);
                if create_missing {
                    match fs::create_dir(&current) {
                        Ok(()) => {}
                        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                        Err(error) => return Err(ContainedFsError::Io(error)),
                    }
                }
                let (handle, final_path) = match open_pinned_directory(&current, true) {
                    Ok(opened) => opened,
                    Err(ContainedFsError::Io(error))
                        if !create_missing && error.kind() == io::ErrorKind::NotFound =>
                    {
                        return Ok(None);
                    }
                    Err(error) => return Err(error),
                };
                if !final_path.starts_with(&root_final) {
                    return Err(ContainedFsError::Containment(format!(
                        "directory {} escapes root directory {}",
                        current.display(),
                        root_final.display()
                    )));
                }
                handles.push(handle);
                current = final_path;
            }

            Ok(Some(Self {
                _pinned_handles: handles,
                dir: current,
            }))
        }

        /// Rejects `file_name` if it exists as a symlink or reparse point.
        ///
        /// # Errors
        ///
        /// Returns [`ContainedFsError::Containment`] if `file_name` is invalid
        /// or refers to a reparse point.
        pub fn reject_symlink(&self, file_name: &OsStr) -> Result<(), ContainedFsError> {
            validate_single_file_name(file_name)?;
            let _ = self.file_identity(file_name)?;
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
            let path = self.dir.join(file_name);
            let file = match OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&path)
            {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(ContainedFsError::Io(error)),
            };
            let info = file_information(file.as_raw_handle())?;
            if (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to write through symlink \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            Ok(Some(FileIdentity {
                volume_serial: info.volume_serial_number,
                file_index_high: info.file_index_high,
                file_index_low: info.file_index_low,
            }))
        }

        /// Reads `file_name` directly from an opened non-reparse handle inside
        /// this pinned directory.
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
            let path = self.dir.join(file_name);
            let mut file = match OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&path)
            {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(ContainedFsError::Io(error)),
            };
            let info = file_information(file.as_raw_handle())?;
            if (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                return Err(ContainedFsError::Containment(format!(
                    "refusing to follow symlink \"{}\"",
                    file_name.to_string_lossy()
                )));
            }
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            Ok(Some(content))
        }

        /// Atomically writes `bytes` to `file_name` inside this pinned directory.
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
        ) -> Result<(), ContainedFsError> {
            self.reject_symlink(file_name)?;
            let destination = self.dir.join(file_name);
            let mut temporary = tempfile::NamedTempFile::new_in(&self.dir)?;
            temporary.write_all(bytes)?;
            temporary.flush()?;
            if durability == ContainedWriteDurability::Full {
                temporary.as_file().sync_all()?;
            }
            temporary
                .persist(&destination)
                .map_err(|error| ContainedFsError::Io(error.error))?;
            Ok(())
        }
    }

    fn open_pinned_directory(
        path: &Path,
        reject_reparse_point: bool,
    ) -> Result<(OwnedHandle, PathBuf), ContainedFsError> {
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        if wide.contains(&0) {
            return Err(ContainedFsError::Containment(
                "path component contains an interior NUL byte".to_owned(),
            ));
        }
        wide.push(0);
        let mut flags = FILE_FLAG_BACKUP_SEMANTICS;
        if reject_reparse_point {
            flags |= FILE_FLAG_OPEN_REPARSE_POINT;
        }
        // Omitting FILE_SHARE_DELETE pins this directory against concurrent
        // rename, deletion, or junction replacement while the handle is open.
        // SAFETY: `wide` is NUL-terminated UTF-16.
        let raw = unsafe {
            CreateFileW(
                wide.as_ptr(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null_mut(),
                OPEN_EXISTING,
                flags,
                std::ptr::null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(ContainedFsError::Io(io::Error::last_os_error()));
        }
        // SAFETY: `raw` is a newly opened valid Windows handle.
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let info = file_information(handle.as_raw_handle())?;
        if reject_reparse_point && (info.file_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
            return Err(ContainedFsError::Containment(format!(
                "refusing to follow symlink or junction at {}",
                path.display()
            )));
        }
        if (info.file_attributes & FILE_ATTRIBUTE_DIRECTORY) == 0 {
            return Err(ContainedFsError::Io(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("{} is not a directory", path.display()),
            )));
        }
        let final_path = final_path_name(handle.as_raw_handle())?;
        Ok((handle, final_path))
    }

    fn file_information(
        handle: *mut std::ffi::c_void,
    ) -> Result<ByHandleFileInformation, ContainedFsError> {
        let mut info = std::mem::MaybeUninit::<ByHandleFileInformation>::uninit();
        // SAFETY: `handle` is open and `info` is writable.
        let ok = unsafe { GetFileInformationByHandle(handle, info.as_mut_ptr()) };
        if ok == 0 {
            return Err(ContainedFsError::Io(io::Error::last_os_error()));
        }
        // SAFETY: `GetFileInformationByHandle` succeeded and initialized `info`.
        Ok(unsafe { info.assume_init() })
    }

    fn final_path_name(handle: *mut std::ffi::c_void) -> Result<PathBuf, ContainedFsError> {
        let mut buffer = vec![0_u16; 260];
        loop {
            // SAFETY: `handle` is open and `buffer` has `buffer.len()` writable UTF-16 units.
            let written = unsafe {
                GetFinalPathNameByHandleW(
                    handle,
                    buffer.as_mut_ptr(),
                    u32::try_from(buffer.len()).unwrap_or(u32::MAX),
                    FILE_NAME_NORMALIZED,
                )
            };
            if written == 0 {
                return Err(ContainedFsError::Io(io::Error::last_os_error()));
            }
            let written_usize = usize::try_from(written).unwrap_or(usize::MAX);
            if written_usize < buffer.len() {
                buffer.truncate(written_usize);
                return Ok(PathBuf::from(OsString::from_wide(&buffer)));
            }
            buffer.resize(written_usize + 1, 0);
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use std::ffi::OsStr;
    use std::fs;
    use std::io::{self, Write};
    use std::path::{Path, PathBuf};

    use super::{
        ContainedFsError, ContainedNewFileMode, ContainedWriteDurability, FileIdentity,
        validate_relative_dir_segments, validate_single_file_name,
    };

    /// Verified directory handle fallback for platforms without Unix/Windows APIs.
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
        ) -> Result<(), ContainedFsError> {
            self.reject_symlink(file_name)?;
            let destination = self.dir.join(file_name);
            let mut temporary = tempfile::NamedTempFile::new_in(&self.dir)?;
            temporary.write_all(bytes)?;
            temporary.flush()?;
            if durability == ContainedWriteDurability::Full {
                temporary.as_file().sync_all()?;
            }
            temporary
                .persist(&destination)
                .map_err(|error| ContainedFsError::Io(error.error))?;
            Ok(())
        }
    }
}

pub use platform::ContainedDir;
