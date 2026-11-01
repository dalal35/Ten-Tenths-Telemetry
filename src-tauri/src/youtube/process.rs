use crate::video_analysis::CancellationToken;
use std::{
    ffi::OsString,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[derive(Debug)]
pub(super) struct Output {
    pub stdout: String,
    pub stderr: String,
}

fn tail(text: &mut String, line: &str, limit: usize) {
    text.push_str(line);
    text.push('\n');
    if text.len() > limit {
        let mut start = text.len() - limit;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        text.drain(..start);
    }
}

fn reader(
    mut input: impl Read + Send + 'static,
    stderr: bool,
    tx: mpsc::SyncSender<(String, bool)>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut line = Vec::new();
        while let Ok(count) = input.read(&mut buffer) {
            if count == 0 {
                break;
            }
            for &byte in &buffer[..count] {
                if byte == b'\n' || byte == b'\r' {
                    if !line.is_empty()
                        && tx
                            .send((String::from_utf8_lossy(&line).into_owned(), stderr))
                            .is_err()
                    {
                        return;
                    }
                    line.clear();
                } else if line.len() < 16384 {
                    line.push(byte);
                }
            }
        }
        if !line.is_empty() {
            let _ = tx.send((String::from_utf8_lossy(&line).into_owned(), stderr));
        }
    })
}

pub(super) fn run(
    executable: &Path,
    args: &[OsString],
    cwd: &Path,
    cancel: &CancellationToken,
    timeout: Duration,
    mut heartbeat: impl FnMut() -> Result<(), String>,
    mut on_line: impl FnMut(&str, bool),
) -> Result<Output, String> {
    if cancel.is_cancelled() {
        return Err("Download cancelled.".into());
    }
    heartbeat()?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
        command.creation_flags(CREATE_NO_WINDOW.0 | CREATE_SUSPENDED.0);
    }
    let mut child = command.spawn().map_err(|e| {
        format!(
            "Cannot start bundled {}: {e}. Reinstall or update Ten Tenths Telemetry.",
            executable.file_name().unwrap_or_default().to_string_lossy()
        )
    })?;
    #[cfg(windows)]
    let group = match WindowsJob::attach_and_resume(&child) {
        Ok(job) => job,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    let pid = child.id();
    let kill = || {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
        #[cfg(windows)]
        group.terminate();
    };
    let (tx, rx) = mpsc::sync_channel(64);
    let stdout = reader(child.stdout.take().unwrap(), false, tx.clone());
    let stderr = reader(child.stderr.take().unwrap(), true, tx);
    let started = Instant::now();
    let mut output = Output {
        stdout: String::new(),
        stderr: String::new(),
    };
    let result = loop {
        while let Ok((line, is_error)) = rx.try_recv() {
            on_line(&line, is_error);
            tail(
                if is_error {
                    &mut output.stderr
                } else {
                    &mut output.stdout
                },
                &line,
                if is_error { 8192 } else { 131072 },
            );
        }
        let error = if cancel.is_cancelled() {
            Some("Download cancelled.".into())
        } else if started.elapsed() > timeout {
            Some("YouTube operation timed out. Check your connection and retry.".into())
        } else {
            heartbeat().err()
        };
        if let Some(error) = error {
            kill();
            let _ = child.wait();
            break Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                kill();
                break if status.success() {
                    Ok(())
                } else {
                    Err(format!("Bundled media tool failed ({status})."))
                };
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                kill();
                let _ = child.wait();
                break Err(format!("Cannot observe media tool: {error}"));
            }
        }
    };
    while let Ok((line, is_error)) = rx.recv_timeout(Duration::from_millis(100)) {
        on_line(&line, is_error);
        tail(
            if is_error {
                &mut output.stderr
            } else {
                &mut output.stdout
            },
            &line,
            if is_error { 8192 } else { 131072 },
        );
    }
    drop(rx);
    let _ = stdout.join();
    let _ = stderr.join();
    match result {
        Ok(()) => Ok(output),
        Err(error) if cancel.is_cancelled() || output.stderr.is_empty() => Err(error),
        Err(error) => Err(format!("{error} {}", diagnostics(&output.stderr))),
    }
}

pub(super) fn diagnostics(input: &str) -> String {
    input
        .split_whitespace()
        .map(|word| {
            if word.contains("://") {
                "[URL]".to_string()
            } else {
                word.chars().filter(|c| !c.is_control()).collect()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(2048)
        .collect()
}

#[cfg(windows)]
struct WindowsJob(windows::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl WindowsJob {
    fn attach_and_resume(child: &std::process::Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::{CloseHandle, HANDLE},
                System::{Diagnostics::ToolHelp::*, JobObjects::*, Threading::*},
            },
        };
        unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).map_err(|e| e.to_string())?;
            let job = Self(handle);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            )
            .map_err(|e| format!("Cannot configure download process group: {e}"))?;
            AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle()))
                .map_err(|e| format!("Cannot own download process group: {e}"))?;
            let snapshot =
                CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0).map_err(|e| e.to_string())?;
            let resumed = (|| {
                let mut entry = THREADENTRY32 {
                    dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
                    ..Default::default()
                };
                Thread32First(snapshot, &mut entry).map_err(|e| e.to_string())?;
                loop {
                    if entry.th32OwnerProcessID == child.id() {
                        let thread = OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID)
                            .map_err(|e| e.to_string())?;
                        let result = ResumeThread(thread);
                        let _ = CloseHandle(thread);
                        return if result == u32::MAX {
                            Err("Cannot resume download process.".into())
                        } else {
                            Ok(())
                        };
                    }
                    if Thread32Next(snapshot, &mut entry).is_err() {
                        return Err("Cannot locate suspended download thread.".into());
                    }
                }
            })();
            let _ = CloseHandle(snapshot);
            resumed?;
            Ok(job)
        }
    }
    fn terminate(&self) {
        unsafe {
            let _ = windows::Win32::System::JobObjects::TerminateJobObject(self.0, 1);
        }
    }
}
#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn cancellation_before_spawn_does_not_start_a_process() {
        let cancel = crate::video_analysis::CancellationToken::default();
        cancel.cancel();
        let result = run(
            std::path::Path::new("/no/such/program"),
            &[],
            std::path::Path::new("/tmp"),
            &cancel,
            std::time::Duration::from_secs(2),
            || Ok(()),
            |_, _| {},
        );
        assert_eq!(result.unwrap_err(), "Download cancelled.");
    }

    #[test]
    fn cancellation_stops_the_process_group_and_keeps_diagnostics_bounded() {
        let cancel = crate::video_analysis::CancellationToken::default();
        let args = [
            std::ffi::OsString::from("-c"),
            std::ffi::OsString::from("sleep 30 & echo ready; wait"),
        ];
        let result = run(
            std::path::Path::new("/bin/sh"),
            &args,
            std::path::Path::new("/tmp"),
            &cancel,
            std::time::Duration::from_secs(2),
            || Ok(()),
            |line, _| {
                if line == "ready" {
                    cancel.cancel();
                }
            },
        );
        assert_eq!(result.unwrap_err(), "Download cancelled.");
    }
}
