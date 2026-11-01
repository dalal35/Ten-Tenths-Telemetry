//! Platform-specific replacement; serialized by the library owner, not a process lock.
#[cfg(not(windows))]
use std::fs::File;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

/// Windows success means synced file contents followed by successful replacement.
/// It does not promise Unix directory-fsync durability across sudden power loss.
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    #[cfg(windows)]
    let mut owned_temp = None;
    #[cfg(not(windows))]
    let temp = path.with_extension("tmp");
    let result = (|| -> std::io::Result<()> {
        #[cfg(windows)]
        let (temp, mut file) = {
            use std::sync::atomic::AtomicU64;
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let (temp, file) = create_temp(path, &NEXT)?;
            owned_temp = Some(temp.clone());
            (temp, file)
        };
        #[cfg(not(windows))]
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        #[cfg(windows)]
        drop(file);
        #[cfg(all(windows, test))]
        fail_replacement(path)?;
        fs::rename(&temp, path)?;
        #[cfg(all(not(windows), test))]
        if FAIL_DIRECTORY_SYNC.with(|failure| failure.borrow().as_deref() == Some(path)) {
            return Err(std::io::Error::other("injected directory sync failure"));
        }
        #[cfg(not(windows))]
        File::open(path.parent().unwrap())?.sync_all()?;
        Ok(())
    })();
    #[cfg(windows)]
    if result.is_err() {
        if let Some(temp) = owned_temp {
            let _ = fs::remove_file(temp);
        }
    }
    result.map_err(|e| {
        format!("Could not save local library: {e}. Your telemetry file is unchanged.")
    })
}

#[cfg(all(not(windows), test))]
thread_local! { pub(crate) static FAIL_DIRECTORY_SYNC: std::cell::RefCell<Option<std::path::PathBuf>> = const { std::cell::RefCell::new(None) }; }

#[cfg(all(windows, test))]
thread_local! { pub(crate) static FAIL_REPLACE: std::cell::RefCell<Option<std::path::PathBuf>> = const { std::cell::RefCell::new(None) }; }
#[cfg(all(windows, test))]
fn fail_replacement(path: &Path) -> std::io::Result<()> {
    FAIL_REPLACE.with(|fail| {
        if fail.borrow().as_deref() == Some(path) {
            Err(std::io::Error::other("injected replacement failure"))
        } else {
            Ok(())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_replacement_preserves_destination_and_cleans_windows_temp() {
        let root = std::env::temp_dir().join(format!("apex-replace-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("destination");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("original"), b"keep").unwrap();
        assert!(atomic_write(&destination, b"new").is_err());
        assert_eq!(fs::read(destination.join("original")).unwrap(), b"keep");
        #[cfg(windows)]
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(windows)]
fn create_temp(
    path: &Path,
    sequence: &std::sync::atomic::AtomicU64,
) -> std::io::Result<(std::path::PathBuf, std::fs::File)> {
    use std::sync::atomic::Ordering;
    for _ in 0..32 {
        let temp = path.with_extension(format!(
            "{}-{}.tmp",
            std::process::id(),
            sequence.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => return Ok((temp, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "Cannot reserve a unique library temporary file",
    ))
}
#[cfg(all(windows, test))]
mod collision_tests {
    use super::*;
    #[test]
    fn existing_temp_is_preserved_and_next_candidate_is_owned() {
        let root = std::env::temp_dir().join(format!("apex-collision-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("library.json");
        let stale = destination.with_extension(format!("{}-0.tmp", std::process::id()));
        fs::write(&stale, b"unowned").unwrap();
        let (temp, mut file) =
            create_temp(&destination, &std::sync::atomic::AtomicU64::new(0)).unwrap();
        file.write_all(b"new").unwrap();
        file.sync_all().unwrap();
        drop(file);
        fs::rename(temp, &destination).unwrap();
        assert_eq!(fs::read(stale).unwrap(), b"unowned");
        assert_eq!(fs::read(destination).unwrap(), b"new");
        fs::remove_dir_all(root).unwrap();
    }
}
