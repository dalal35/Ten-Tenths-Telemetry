//! Synthetic library saves: no private XRK fixtures required.
use apex_telemetry::library::Library;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "apex 保存 café {}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn seed(&self) {
        fs::write(
            self.0.join("library.json"),
            serde_json::to_vec(&manifest()).unwrap(),
        )
        .unwrap();
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn manifest() -> Value {
    json!({"version":1,"entries":[{"id":"synthetic","source":"missing.xrk","name":"Synthetic","driver":"","track":"","recordedAt":"2026-10-15 12:00:00","lapCount":0,"channelCount":0,"contentVersion":"a".repeat(64),"lastUsed":0,"workspace":null}],"activeSessionId":null})
}
#[test]
fn successive_workspace_saves_replace_and_survive_reopen() {
    let root = Sandbox::new();
    root.seed();
    let mut library = Library::open(root.0.clone()).unwrap();
    for value in [1, 2, 3] {
        library
            .save_workspace("synthetic", json!({"revision":value}))
            .unwrap();
        let mut reopened = Library::open(root.0.clone()).unwrap();
        assert_eq!(
            reopened.snapshot().unwrap().entries[0].workspace,
            Some(json!({"revision":value}))
        );
    }
    let backup: Value =
        serde_json::from_slice(&fs::read(root.0.join("library.backup.json")).unwrap()).unwrap();
    assert_eq!(backup["entries"][0]["workspace"]["revision"], 2);
}
#[test]
fn damaged_primary_recovers_backup_and_ignores_interrupted_temp() {
    let root = Sandbox::new();
    root.seed();
    let mut library = Library::open(root.0.clone()).unwrap();
    library
        .save_workspace("synthetic", json!({"revision":1}))
        .unwrap();
    library
        .save_workspace("synthetic", json!({"revision":2}))
        .unwrap();
    fs::write(root.0.join("library.json"), b"damaged").unwrap();
    fs::write(root.0.join("library.tmp"), b"interrupted").unwrap();
    let mut recovered = Library::open(root.0.clone()).unwrap();
    let snapshot = recovered.snapshot().unwrap();
    assert_eq!(snapshot.entries[0].workspace, Some(json!({"revision":1})));
    assert!(!snapshot.warnings.is_empty());
    recovered
        .save_workspace("synthetic", json!({"revision":3}))
        .unwrap();
    assert_eq!(
        Library::open(root.0.clone())
            .unwrap()
            .snapshot()
            .unwrap()
            .entries[0]
            .workspace,
        Some(json!({"revision":3}))
    );
}
#[test]
fn future_schema_is_never_replaced_by_backup_or_save() {
    let root = Sandbox::new();
    root.seed();
    let mut library = Library::open(root.0.clone()).unwrap();
    let future = b"{\"version\":999}";
    fs::write(root.0.join("library.json"), future).unwrap();
    fs::write(
        root.0.join("library.backup.json"),
        serde_json::to_vec(&manifest()).unwrap(),
    )
    .unwrap();
    assert!(Library::open(root.0.clone()).is_err());
    assert!(library
        .save_workspace("synthetic", json!({"revision":1}))
        .is_err());
    assert_eq!(fs::read(root.0.join("library.json")).unwrap(), future);
    assert_eq!(library.snapshot().unwrap().entries[0].workspace, None);
}

#[test]
fn rebrand_reopens_existing_library_without_migrating_workspace_data() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["identifier"], "com.dalal35.apextelemetry");
    assert_eq!(config["productName"], "Ten Tenths Telemetry");
    let root = Sandbox::new();
    let workspace = json!({
        "contentVersion":"a".repeat(64),"primary":"lap-1","comparison":"lap-2",
        "axis":"distance","channels":["speed","custom-channel"],
        "advanced":{"formulas":[{"id":"math-1","expression":"speed * 2"}],"preset":"driver"},
        "cornerBoundaries":[12.0,40.0],
        "video":{"sources":[{"id":"camera-1","path":"/old library/onboard.mp4"}],
                 "segments":[{"telemetryStart":10.0,"videoStart":4.0}]},
        "futureExtension":{"preserve":true}
    });
    let mut legacy = manifest();
    legacy["entries"][0]["workspace"] = workspace.clone();
    let original = serde_json::to_vec(&legacy).unwrap();
    fs::write(root.0.join("library.json"), &original).unwrap();
    let mut library = Library::open(root.0.clone()).unwrap();
    assert_eq!(
        library.snapshot().unwrap().entries[0].workspace,
        Some(workspace.clone())
    );
    assert_eq!(fs::read(root.0.join("library.json")).unwrap(), original);
    library
        .save_workspace("synthetic", workspace.clone())
        .unwrap();
    assert_eq!(
        Library::open(root.0.clone())
            .unwrap()
            .snapshot()
            .unwrap()
            .entries[0]
            .workspace,
        Some(workspace)
    );
}
