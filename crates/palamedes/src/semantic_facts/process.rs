use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::JoinHandle;

use serde_json::{json, Value};

use super::client::{CancellationToken, SemanticSnapshotTransport, SemanticTransportError};

const MAX_MESSAGE_BYTES: usize = 256 * 1024 * 1024;

/// A synchronous Rust owner for TS7's asynchronous, framed JSON-RPC process API.
///
/// Requests are sequential at this boundary. Cancellation is sent from a small
/// owned watcher thread as `$/cancelRequest`; no async runtime is introduced.
pub struct ProcessSemanticSnapshotTransport {
    executable: PathBuf,
    child: Option<Child>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    stdout: BufReader<std::process::ChildStdout>,
    stderr: Arc<Mutex<Vec<u8>>>,
    stderr_reader: Option<JoinHandle<()>>,
    next_request_id: u64,
}

impl ProcessSemanticSnapshotTransport {
    /// Starts `tsgo --api --async --cwd <cwd>` with piped standard streams.
    ///
    /// # Errors
    ///
    /// Returns [`SemanticTransportError::Spawn`] when the executable cannot be started.
    pub fn spawn(
        executable: impl AsRef<Path>,
        cwd: impl AsRef<Path>,
    ) -> Result<Self, SemanticTransportError> {
        let executable = executable.as_ref().to_path_buf();
        let mut child = Command::new(&executable)
            .args(["--api", "--async", "--cwd"])
            .arg(cwd.as_ref())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|source| SemanticTransportError::Spawn {
                executable: executable.display().to_string(),
                source,
            })?;
        let stdin = child
            .stdin
            .take()
            .expect("piped child stdin must be available after spawn");
        let stdout = child
            .stdout
            .take()
            .expect("piped child stdout must be available after spawn");
        let mut child_stderr = child
            .stderr
            .take()
            .expect("piped child stderr must be available after spawn");
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let stderr_target = Arc::clone(&stderr);
        let stderr_reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = child_stderr.read_to_end(&mut bytes);
            *stderr_target
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = bytes;
        });

        Ok(Self {
            executable,
            child: Some(child),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            stdout: BufReader::new(stdout),
            stderr,
            stderr_reader: Some(stderr_reader),
            next_request_id: 1,
        })
    }

    fn write_value(&self, value: &Value) -> Result<(), SemanticTransportError> {
        write_value(&self.stdin, value)
    }

    fn read_response(&mut self, request_id: u64) -> Result<Value, SemanticTransportError> {
        let bytes = match read_message(&mut self.stdout) {
            Ok(bytes) => bytes,
            Err(source) if source.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Err(self.process_exited_error());
            }
            Err(source) => {
                return Err(SemanticTransportError::Io {
                    operation: "read",
                    source,
                });
            }
        };
        let response: Value = serde_json::from_slice(&bytes).map_err(|error| {
            SemanticTransportError::InvalidResponse(format!("invalid JSON: {error}"))
        })?;
        if response.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
            return Err(SemanticTransportError::InvalidResponse(
                "missing jsonrpc 2.0 marker".to_owned(),
            ));
        }
        if response.get("id").and_then(Value::as_u64) != Some(request_id) {
            return Err(SemanticTransportError::InvalidResponse(format!(
                "response id did not match request {request_id}"
            )));
        }
        if let Some(error) = response.get("error") {
            let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32603);
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown protocol error")
                .to_owned();
            return if code == -32800 {
                Err(SemanticTransportError::Cancelled)
            } else {
                Err(SemanticTransportError::Protocol { code, message })
            };
        }
        response.get("result").cloned().ok_or_else(|| {
            SemanticTransportError::InvalidResponse(
                "response contains neither result nor error".to_owned(),
            )
        })
    }

    fn process_exited_error(&mut self) -> SemanticTransportError {
        let code = self
            .child
            .take()
            .and_then(|mut child| child.wait().ok())
            .and_then(|status| status.code());
        if let Some(reader) = self.stderr_reader.take() {
            let _ = reader.join();
        }
        SemanticTransportError::ProcessExited {
            code,
            stderr: self.stderr_text(),
        }
    }

    fn stderr_text(&self) -> String {
        let bytes = self
            .stderr
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        String::from_utf8_lossy(&bytes).trim().to_owned()
    }
}

impl SemanticSnapshotTransport for ProcessSemanticSnapshotTransport {
    fn request(
        &mut self,
        method: &str,
        params: Value,
        cancellation: &CancellationToken,
    ) -> Result<Value, SemanticTransportError> {
        if self.child.is_none() {
            return Err(SemanticTransportError::Closed);
        }
        if cancellation.is_cancelled() {
            return Err(SemanticTransportError::Cancelled);
        }
        let request_id = self.next_request_id;
        self.next_request_id = self.next_request_id.checked_add(1).ok_or_else(|| {
            SemanticTransportError::InvalidResponse("request id overflow".to_owned())
        })?;
        self.write_value(&json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }))?;

        let done = Arc::new(AtomicBool::new(false));
        let watcher_done = Arc::clone(&done);
        let watcher_cancellation = cancellation.clone();
        let watcher_stdin = Arc::clone(&self.stdin);
        let watcher = std::thread::spawn(move || {
            watcher_cancellation.wait_until_cancelled_or_done(&watcher_done);
            if watcher_cancellation.is_cancelled() && !watcher_done.load(Ordering::Acquire) {
                let _ = write_value(
                    &watcher_stdin,
                    &json!({
                        "jsonrpc": "2.0",
                        "method": "$/cancelRequest",
                        "params": { "id": request_id },
                    }),
                );
            }
        });

        let response = self.read_response(request_id);
        done.store(true, Ordering::Release);
        cancellation.wake_waiters();
        let _ = watcher.join();
        response
    }

    fn description(&self) -> String {
        format!("{} --api --async", self.executable.display())
    }

    fn close(&mut self) -> Result<(), SemanticTransportError> {
        self.stdin
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(mut child) = self.child.take() {
            child.wait().map_err(|source| SemanticTransportError::Io {
                operation: "wait for shutdown",
                source,
            })?;
        }
        if let Some(reader) = self.stderr_reader.take() {
            let _ = reader.join();
        }
        Ok(())
    }
}

impl Drop for ProcessSemanticSnapshotTransport {
    fn drop(&mut self) {
        self.stdin
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(mut child) = self.child.take() {
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
            }
        }
    }
}

fn write_value(
    stdin: &Arc<Mutex<Option<ChildStdin>>>,
    value: &Value,
) -> Result<(), SemanticTransportError> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        SemanticTransportError::InvalidResponse(format!("request encoding failed: {error}"))
    })?;
    let mut guard = stdin
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let writer = guard.as_mut().ok_or(SemanticTransportError::Closed)?;
    write!(writer, "Content-Length: {}\r\n\r\n", bytes.len()).map_err(|source| {
        SemanticTransportError::Io {
            operation: "write header",
            source,
        }
    })?;
    writer
        .write_all(&bytes)
        .and_then(|()| writer.flush())
        .map_err(|source| SemanticTransportError::Io {
            operation: "write payload",
            source,
        })
}

fn read_message(reader: &mut impl BufRead) -> std::io::Result<Vec<u8>> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "semantic-facts process closed stdout",
            ));
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("Content-Length") {
                content_length = Some(value.trim().parse::<usize>().map_err(|error| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, error)
                })?);
            }
        }
    }
    let content_length = content_length.ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "missing Content-Length header",
        )
    })?;
    if content_length > MAX_MESSAGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("message exceeds {MAX_MESSAGE_BYTES} byte limit"),
        ));
    }
    let mut bytes = vec![0; content_length];
    reader.read_exact(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::read_message;

    #[test]
    fn reads_lsp_framed_json() {
        let mut input = Cursor::new(b"Content-Length: 13\r\n\r\n{\"result\":42}");
        assert_eq!(read_message(&mut input).unwrap(), br#"{"result":42}"#);
    }

    #[test]
    fn rejects_missing_content_length() {
        let mut input = Cursor::new(b"X-Test: value\r\n\r\n{}");
        assert_eq!(
            read_message(&mut input).unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
    }
}
