//! Directory-handle-pinned filesystem operations for catalog reads and writes.
//!
//! On Unix, every directory traversal, creation, read, and atomic replacement
//! is performed relative to an open directory file descriptor with
//! `O_NOFOLLOW`, preventing TOCTOU symlink swaps on parent directories as well
//! as hard-link overwrites of targets outside the verified directory.

use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Component, Path, PathBuf};

/// Splits a validated catalog path inside `root_dir` into its relative parent
/// directory and single-segment filename.
pub(crate) fn split_relative_catalog_path(
    root_dir: &Path,
    target: &Path,
) -> io::Result<(PathBuf, OsString)> {
    let relative = target.strip_prefix(root_dir).map_err(|_| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "path {} escapes root directory {}",
                target.display(),
                root_dir.display()
            ),
        )
    })?;
    let mut segments = Vec::new();
    for component in relative.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => segments.push(part.to_os_string()),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "path {} escapes root directory {}",
                        target.display(),
                        root_dir.display()
                    ),
                ));
            }
        }
    }
    let Some(file_name) = segments.pop() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("path {} has no filename component", target.display()),
        ));
    };
    let mut parent = PathBuf::new();
    for segment in segments {
        parent.push(segment);
    }
    Ok((parent, file_name))
}

fn validate_single_file_name(file_name: &OsStr) -> io::Result<()> {
    let mut components = Path::new(file_name).components();
    if matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "filename \"{}\" must be a single path segment",
                file_name.to_string_lossy()
            ),
        ))
    }
}

fn validate_relative_dir_segments(relative_dir: &Path) -> io::Result<Vec<OsString>> {
    let mut segments = Vec::new();
    for component in relative_dir.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(part) => segments.push(part.to_os_string()),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "relative directory {} contains an escaping component",
                        relative_dir.display()
                    ),
                ));
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

    use super::{validate_relative_dir_segments, validate_single_file_name};

    static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

    pub(crate) struct ContainedDir {
        fd: OwnedFd,
    }

    impl ContainedDir {
        pub(crate) fn open_root(root_dir: &Path) -> io::Result<Self> {
            let c_path = os_str_to_cstring(root_dir.as_os_str())?;
            // SAFETY: `c_path` is a valid NUL-terminated path string.
            let raw = unsafe {
                libc::open(
                    c_path.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            };
            if raw < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: `raw` is a newly opened valid file descriptor owned by this struct.
            let fd = unsafe { OwnedFd::from_raw_fd(raw) };
            Ok(Self { fd })
        }

        pub(crate) fn open_subpath(
            root_dir: &Path,
            relative_dir: &Path,
            create_missing: bool,
        ) -> io::Result<Option<Self>> {
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
                            return Err(error);
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
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            format!(
                                "refusing to follow symlink at directory component \"{}\"",
                                segment.to_string_lossy()
                            ),
                        ));
                    }
                    return Err(error);
                }
                // SAFETY: `next` is a newly opened valid file descriptor.
                current = Self {
                    fd: unsafe { OwnedFd::from_raw_fd(next) },
                };
            }
            Ok(Some(current))
        }

        pub(crate) fn reject_symlink(&self, file_name: &OsStr) -> io::Result<()> {
            validate_single_file_name(file_name)?;
            let _ = self.inspect_existing_mode(file_name)?;
            Ok(())
        }

        pub(crate) fn read_optional_file(&self, file_name: &OsStr) -> io::Result<Option<String>> {
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
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        format!(
                            "refusing to follow symlink \"{}\"",
                            file_name.to_string_lossy()
                        ),
                    ));
                }
                return Err(error);
            }
            // SAFETY: `raw` is a newly opened valid file descriptor.
            let mut file = File::from(unsafe { OwnedFd::from_raw_fd(raw) });
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            Ok(Some(content))
        }

        pub(crate) fn write_file_atomically(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> io::Result<()> {
            validate_single_file_name(file_name)?;
            let existing_mode = self.inspect_existing_mode(file_name)?;
            let c_target = os_str_to_cstring(file_name)?;

            let (temp_name, mut temp_file) = self.create_temp_file()?;
            let write_result = (|| -> io::Result<()> {
                temp_file.write_all(bytes)?;
                temp_file.flush()?;
                if let Some(mode) = existing_mode {
                    // Preserve existing file permissions verbatim on overwrite.
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
                return Err(error);
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
                return Err(error);
            }
            Ok(())
        }

        fn inspect_existing_mode(&self, file_name: &OsStr) -> io::Result<Option<libc::mode_t>> {
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
                return Err(error);
            }
            // SAFETY: `fstatat` succeeded and initialized `stat`.
            let stat = unsafe { stat.assume_init() };
            if (stat.st_mode & libc::S_IFMT) == libc::S_IFLNK {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "refusing to write through symlink \"{}\"",
                        file_name.to_string_lossy()
                    ),
                ));
            }
            Ok(Some(stat.st_mode & 0o7777))
        }

        fn create_temp_file(&self) -> io::Result<(CString, File)> {
            let pid = std::process::id();
            for _ in 0..128 {
                let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
                let name = OsString::from(format!(".pmds-tmp-{pid}-{nonce}"));
                let c_name = os_str_to_cstring(&name)?;
                // Creating with 0o666 applies the process umask identically to `fs::write`.
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
                        0o666 as libc::c_uint,
                    )
                };
                if raw >= 0 {
                    // SAFETY: `raw` is a newly opened valid file descriptor.
                    return Ok((c_name, File::from(unsafe { OwnedFd::from_raw_fd(raw) })));
                }
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::EEXIST) {
                    return Err(error);
                }
            }
            Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "could not allocate a unique temporary file in destination directory",
            ))
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

    fn os_str_to_cstring(value: &OsStr) -> io::Result<CString> {
        CString::new(value.as_bytes()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "path component contains an interior NUL byte",
            )
        })
    }
}

#[cfg(not(unix))]
mod platform {
    use std::ffi::OsStr;
    use std::fs;
    use std::io::{self, Write};
    use std::path::{Path, PathBuf};

    use super::{validate_relative_dir_segments, validate_single_file_name};

    pub(crate) struct ContainedDir {
        dir: PathBuf,
    }

    impl ContainedDir {
        pub(crate) fn open_root(root_dir: &Path) -> io::Result<Self> {
            Ok(Self {
                dir: fs::canonicalize(root_dir)?,
            })
        }

        pub(crate) fn open_subpath(
            root_dir: &Path,
            relative_dir: &Path,
            create_missing: bool,
        ) -> io::Result<Option<Self>> {
            let segments = validate_relative_dir_segments(relative_dir)?;
            let canonical_root = fs::canonicalize(root_dir)?;
            let mut current = canonical_root.clone();
            for segment in segments {
                current.push(&segment);
                match fs::symlink_metadata(&current) {
                    Ok(metadata) => {
                        if metadata.file_type().is_symlink() {
                            return Err(io::Error::new(
                                io::ErrorKind::PermissionDenied,
                                format!(
                                    "refusing to follow symlink at directory component \"{}\"",
                                    segment.to_string_lossy()
                                ),
                            ));
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        if !create_missing {
                            return Ok(None);
                        }
                        fs::create_dir(&current)?;
                    }
                    Err(error) => return Err(error),
                }
                let canonical = fs::canonicalize(&current)?;
                if !canonical.starts_with(&canonical_root) {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        format!(
                            "directory {} escapes root directory {}",
                            current.display(),
                            canonical_root.display()
                        ),
                    ));
                }
                current = canonical;
            }
            Ok(Some(Self { dir: current }))
        }

        pub(crate) fn reject_symlink(&self, file_name: &OsStr) -> io::Result<()> {
            validate_single_file_name(file_name)?;
            let path = self.dir.join(file_name);
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_symlink() => Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!(
                        "refusing to write through symlink \"{}\"",
                        file_name.to_string_lossy()
                    ),
                )),
                Ok(_) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            }
        }

        pub(crate) fn read_optional_file(&self, file_name: &OsStr) -> io::Result<Option<String>> {
            self.reject_symlink(file_name)?;
            let path = self.dir.join(file_name);
            match fs::read_to_string(&path) {
                Ok(content) => Ok(Some(content)),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(error),
            }
        }

        pub(crate) fn write_file_atomically(
            &self,
            file_name: &OsStr,
            bytes: &[u8],
        ) -> io::Result<()> {
            self.reject_symlink(file_name)?;
            let destination = self.dir.join(file_name);
            let mut temporary = tempfile::NamedTempFile::new_in(&self.dir)?;
            temporary.write_all(bytes)?;
            temporary.flush()?;
            temporary
                .persist(&destination)
                .map_err(|error| error.error)?;
            Ok(())
        }
    }
}

pub(crate) use platform::ContainedDir;
