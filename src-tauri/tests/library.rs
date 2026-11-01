use apex_telemetry::library::Library;
use std::{fs, path::PathBuf};
fn sandbox(label: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("apex-library-{label}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    p
}
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0361.xrk")
}
#[test]
fn stale_workspace_cannot_restore_state_cleared_by_refresh() {
    let p = sandbox("stale-workspace");
    let file = p.join("session.xrk");
    fs::copy(fixture(), &file).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    let s = lib.import(&file).unwrap();
    let version = lib.snapshot().unwrap().entries[0].content_version.clone();
    fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk"),
        &file,
    )
    .unwrap();
    lib.refresh(&s.id).unwrap();
    assert!(lib
        .save_workspace_version(&s.id, serde_json::json!({"axis":"time"}), &version)
        .is_err());
    assert!(lib.snapshot().unwrap().entries[0].workspace.is_none());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn persists_summaries_workspace_and_duplicate_identity_without_raw_samples() {
    let p = sandbox("restore");
    let file = p.join("original.xrk");
    fs::copy(fixture(), &file).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    let s = lib.import(&file).unwrap();
    lib.save_workspace(&s.id, serde_json::json!({"axis":"time"}))
        .unwrap();
    let duplicate = p.join("duplicate.xrk");
    fs::copy(&file, &duplicate).unwrap();
    assert_eq!(lib.import(&duplicate).unwrap().id, s.id);
    assert_eq!(lib.snapshot().unwrap().entries.len(), 1);
    let wire = serde_json::to_value(lib.snapshot().unwrap()).unwrap();
    assert_eq!(
        wire["entries"][0]["status"], "ready",
        "native UI must receive computed file status"
    );
    let mut reopened = Library::open(p.join("store")).unwrap();
    assert_eq!(
        reopened.snapshot().unwrap().active_session_id,
        Some(s.id.clone())
    );
    assert_eq!(
        reopened.snapshot().unwrap().entries[0]
            .workspace
            .as_ref()
            .unwrap()["axis"],
        "time"
    );
    assert_eq!(reopened.load(&s.id).unwrap().laps.len(), s.laps.len());
    let bytes = fs::read_to_string(p.join("store/library.json")).unwrap();
    assert!(!bytes.contains("\"channels\""));
    assert!(bytes.len() < 20000);
    reopened.remove(&s.id).unwrap();
    assert!(file.exists());
    assert!(duplicate.exists());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn detects_same_size_changes_requires_refresh_and_matching_relocation() {
    let p = sandbox("lifecycle");
    let file = p.join("original.xrk");
    fs::copy(fixture(), &file).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    let s = lib.import(&file).unwrap();
    lib.save_workspace(&s.id, serde_json::json!({"axis":"distance"}))
        .unwrap();
    let original = fs::read(&file).unwrap();
    let mut changed = original.clone();
    changed[0] ^= 1;
    fs::write(&file, &changed).unwrap();
    assert_eq!(lib.snapshot().unwrap().entries[0].status, "modified");
    assert!(lib.load(&s.id).is_err());
    let invalid = p.join("invalid.xrk");
    fs::write(&invalid, b"invalid").unwrap();
    assert!(lib.locate(&s.id, &invalid).is_err());
    fs::write(&file, b"invalid").unwrap();
    assert!(lib.refresh(&s.id).is_err());
    assert!(lib.snapshot().unwrap().entries[0].workspace.is_some());
    fs::remove_file(&file).unwrap();
    assert_eq!(lib.snapshot().unwrap().entries[0].status, "missing");
    let located = p.join("located.xrk");
    fs::write(&located, &original).unwrap();
    lib.locate(&s.id, &located).unwrap();
    assert_eq!(lib.snapshot().unwrap().entries[0].status, "ready");
    assert!(lib.snapshot().unwrap().entries[0].workspace.is_some());
    fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk"),
        &located,
    )
    .unwrap();
    lib.refresh(&s.id).unwrap();
    assert!(lib.snapshot().unwrap().entries[0].workspace.is_none());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn recovers_backup_without_clobbering_unsupported_or_unrecoverable_manifest() {
    let p = sandbox("recovery");
    let store = p.join("store");
    let mut lib = Library::open(store.clone()).unwrap();
    let s = lib.import(&fixture()).unwrap();
    lib.save_workspace(&s.id, serde_json::json!({"axis":"time"}))
        .unwrap();
    fs::write(store.join("library.json"), b"interrupted").unwrap();
    let mut recovered = Library::open(store.clone()).unwrap();
    assert_eq!(recovered.snapshot().unwrap().entries.len(), 1);
    assert!(!recovered.snapshot().unwrap().warnings.is_empty());
    recovered
        .save_workspace(&s.id, serde_json::json!({"axis":"distance"}))
        .unwrap();
    fs::write(
        store.join("library.json"),
        br#"{"version":999,"entries":[]}"#,
    )
    .unwrap();
    assert!(Library::open(store.clone()).is_err());
    assert!(fs::read_to_string(store.join("library.json"))
        .unwrap()
        .contains("999"));
    fs::write(store.join("library.json"), b"broken").unwrap();
    fs::write(store.join("library.backup.json"), b"broken").unwrap();
    assert!(Library::open(store).is_err());
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn corner_overrides_survive_reopen_reset_and_invalidate_on_refresh() {
    let p = sandbox("corners");
    let file = p.join("source.xrk");
    fs::copy(fixture(), &file).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    let session = lib.import(&file).unwrap();
    let primary = &session.laps.iter().find(|lap| lap.complete).unwrap().id;
    let automatic = lib
        .analyze(&session.id, primary, None, "distance", &[])
        .unwrap();
    let mut boundaries = automatic
        .segments
        .iter()
        .skip(1)
        .map(|s| s.start_meters)
        .collect::<Vec<_>>();
    boundaries[0] += 1.;
    lib.set_corner_boundaries(&session.id, primary, Some(boundaries.clone()))
        .unwrap();
    drop(lib);
    let mut lib = Library::open(p.join("store")).unwrap();
    assert!(lib
        .analyze(&session.id, primary, None, "distance", &[])
        .unwrap()
        .corner_boundaries
        .unwrap()
        .iter()
        .zip(&boundaries)
        .all(|(a, b)| (a - b).abs() < 1e-9));
    assert!(lib
        .set_corner_boundaries(&session.id, primary, Some(vec![0.; boundaries.len()]))
        .is_err());
    assert!(lib
        .analyze(&session.id, primary, None, "distance", &[])
        .unwrap()
        .corner_boundaries
        .unwrap()
        .iter()
        .zip(&boundaries)
        .all(|(a, b)| (a - b).abs() < 1e-9));
    lib.set_corner_boundaries(&session.id, primary, None)
        .unwrap();
    assert!(lib
        .analyze(&session.id, primary, None, "distance", &[])
        .unwrap()
        .corner_boundaries
        .is_none());
    lib.set_corner_boundaries(&session.id, primary, Some(boundaries))
        .unwrap();
    fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk"),
        &file,
    )
    .unwrap();
    // Cached data must also refuse to analyze a changed source.
    assert!(lib
        .analyze(&session.id, primary, None, "distance", &[])
        .is_err());
    lib.refresh(&session.id).unwrap();
    assert!(lib
        .analyze(&session.id, primary, None, "distance", &[])
        .unwrap()
        .corner_boundaries
        .is_none());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn rejects_oversized_workspace_and_duplicate_refresh_without_losing_prior_state() {
    let p = sandbox("bounds");
    let file = p.join("source.xrk");
    fs::copy(fixture(), &file).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    let first = lib.import(&file).unwrap();
    lib.save_workspace(&first.id, serde_json::json!({"axis":"time"}))
        .unwrap();
    assert!(lib
        .save_workspace(&first.id, serde_json::json!({"text":"a".repeat(65536)}))
        .is_err());
    assert!(lib
        .save_workspace(&first.id, serde_json::json!([]))
        .is_err());
    let second = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk");
    lib.import(&second).unwrap();
    fs::copy(second, &file).unwrap();
    assert!(lib.refresh(&first.id).is_err());
    let snapshot = lib.snapshot().unwrap();
    assert_eq!(snapshot.entries.len(), 2);
    assert_eq!(
        snapshot
            .entries
            .iter()
            .find(|e| e.id == first.id)
            .unwrap()
            .workspace
            .as_ref()
            .unwrap()["axis"],
        "time"
    );
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn ignores_interrupted_temp_file_and_refuses_newer_manifest_written_while_running() {
    let p = sandbox("interrupted");
    let store = p.join("store");
    let mut lib = Library::open(store.clone()).unwrap();
    let session = lib.import(&fixture()).unwrap();
    fs::write(store.join("library.tmp"), b"interrupted").unwrap();
    let mut reopened = Library::open(store.clone()).unwrap();
    assert_eq!(reopened.snapshot().unwrap().entries.len(), 1);
    fs::write(
        store.join("library.json"),
        br#"{"version":999,"entries":[]}"#,
    )
    .unwrap();
    assert!(lib
        .save_workspace(&session.id, serde_json::json!({"axis":"time"}))
        .is_err());
    assert!(fs::read_to_string(store.join("library.json"))
        .unwrap()
        .contains("999"));
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn video_workspace_round_trips_atomically_with_advanced_state_and_version_guards() {
    let p = sandbox("video-workspace");
    let store = p.join("store");
    let mut lib = Library::open(store.clone()).unwrap();
    let session = lib.import(&fixture()).unwrap();
    let version = lib.snapshot().unwrap().entries[0].content_version.clone();
    // Existing workspaces without video remain readable.
    let old = serde_json::json!({"axis":"time","advanced":{"version":1}});
    lib.save_workspace_version(&session.id, old.clone(), &version)
        .unwrap();
    drop(lib);
    let mut lib = Library::open(store.clone()).unwrap();
    assert_eq!(
        lib.snapshot().unwrap().entries[0].workspace.as_ref(),
        Some(&old)
    );
    let segments = (0..100)
        .map(|i| {
            serde_json::json!({
                "id":format!("segment-{i}"),"videoStart":i,"videoEnd":i+1,
                "anchorVideoTime":i,"anchorTelemetryTime":i,"correctionSeconds":0
            })
        })
        .collect::<Vec<_>>();
    let workspace = serde_json::json!({
        "contentVersion":version,"axis":"time","view":"video",
        "advanced":{"version":1,"formulas":[],"presets":[]},
        "video":{"version":1,"sessionId":session.id,"contentVersion":version,
            "source":{"type":"local","path":"/local/track.mp4","size":123456,"modifiedMs":1234},
            "segments":segments,"selectedSegmentId":"segment-0",
            "preferences":{"panelHeight":400,"playbackRate":1,"pausedVideoTime":12}}
    });
    lib.save_workspace_version(&session.id, workspace.clone(), &version)
        .unwrap();
    assert!(!store.join("library.tmp").exists());
    drop(lib);
    let mut reopened = Library::open(store.clone()).unwrap();
    assert_eq!(
        reopened.snapshot().unwrap().entries[0].workspace.as_ref(),
        Some(&workspace)
    );
    // Unknown future video fields are opaque to the manifest and survive ordinary saves.
    let mut future = workspace.clone();
    future["video"]["version"] = serde_json::json!(2);
    future["video"]["opaque"] = serde_json::json!({"preserve":[1,"二",true]});
    reopened
        .save_workspace_version(&session.id, future.clone(), &version)
        .unwrap();
    assert!(reopened
        .save_workspace_version(&session.id, workspace.clone(), "stale-version")
        .is_err());
    let mut oversized = workspace;
    oversized["advanced"]["opaque"] = serde_json::json!("x".repeat(60000));
    assert!(serde_json::to_vec(&oversized["video"]).unwrap().len() < 65536);
    assert!(serde_json::to_vec(&oversized["advanced"]).unwrap().len() < 65536);
    assert!(reopened
        .save_workspace_version(&session.id, oversized, &version)
        .is_err());
    drop(reopened);
    let mut reopened = Library::open(store).unwrap();
    assert_eq!(
        reopened.snapshot().unwrap().entries[0].workspace.as_ref(),
        Some(&future)
    );
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn edited_details_survive_cache_reopen_reimport_locate_and_refresh() {
    let p = sandbox("details");
    let file = p.join("source.xrk");
    fs::copy(fixture(), &file).unwrap();
    let original_bytes = fs::read(&file).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    let session = lib.import(&file).unwrap();
    let workspace = serde_json::json!({"axis":"time"});
    lib.save_workspace(&session.id, workspace.clone()).unwrap();
    let before = lib.snapshot().unwrap().entries[0].clone();
    let updated = lib
        .update_details(&session.id, "  Practice  ", "  Alex  ", "2024-02-29")
        .unwrap();
    assert_eq!(updated.name, "Practice");
    assert_eq!(updated.driver, "Alex");
    assert_eq!(updated.content_version, before.content_version);
    assert_eq!(updated.last_used, before.last_used);
    assert_eq!(updated.workspace, Some(workspace.clone()));
    assert_eq!(lib.load(&session.id).unwrap().name, "Practice");
    assert_eq!(lib.import(&file).unwrap().recorded_at, "2024-02-29");
    assert_eq!(fs::read(&file).unwrap(), original_bytes);
    drop(lib);
    let mut lib = Library::open(p.join("store")).unwrap();
    assert_eq!(lib.load(&session.id).unwrap().driver, "Alex");
    assert_eq!(lib.refresh(&session.id).unwrap().recorded_at, "2024-02-29");
    fs::remove_file(&file).unwrap();
    lib.update_details(&session.id, "Missing run", "", "2026-10-23")
        .unwrap();
    fs::write(&file, &original_bytes).unwrap();
    assert_eq!(lib.locate(&session.id, &file).unwrap().name, "Missing run");
    fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0362.xrk"),
        &file,
    )
    .unwrap();
    let refreshed = lib.refresh(&session.id).unwrap();
    assert_eq!(refreshed.name, "Missing run");
    assert_eq!(refreshed.recorded_at, "2026-10-23");
    assert_eq!(refreshed.id, session.id);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn invalid_details_leave_manifest_and_cached_session_unchanged() {
    let p = sandbox("details-invalid");
    let mut lib = Library::open(p.join("store")).unwrap();
    let session = lib.import(&fixture()).unwrap();
    let before = fs::read(p.join("store/library.json")).unwrap();
    for (name, driver, date) in [
        (" ", "", "2026-10-23"),
        ("New", "", "2023-02-29"),
        ("New", "bad\nname", "2026-10-23"),
        ("New", "", ""),
        ("New", "", "2026-13-01"),
    ] {
        assert!(lib.update_details(&session.id, name, driver, date).is_err());
    }
    assert!(lib
        .update_details("unknown", "New", "", "2026-10-23")
        .is_err());
    assert_eq!(fs::read(p.join("store/library.json")).unwrap(), before);
    assert_eq!(lib.load(&session.id).unwrap().name, session.name);
    // Editing another field preserves the full existing recording timestamp.
    lib.update_details(
        &session.id,
        "Name only",
        &session.driver,
        &session.recorded_at,
    )
    .unwrap();
    assert_eq!(
        lib.load(&session.id).unwrap().recorded_at,
        session.recorded_at
    );
    fs::remove_dir_all(p).unwrap();
}
