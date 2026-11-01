use apex_telemetry::library::Library;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
fn setup(label: &str) -> (PathBuf, Library, Vec<String>) {
    let p = std::env::temp_dir().join(format!("apex-merging-{label}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    let mut ids = vec![];
    for n in [361, 362] {
        let original = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
            "../data/yash dalal_59_PURDUE GP IN_Warm-up_a_0{n}.xrk"
        ));
        let mut bytes = fs::read(original).unwrap();
        let offset = bytes.windows(10).position(|s| s == b"10/07/2026").unwrap();
        bytes[offset..offset + 10].copy_from_slice(b"10/14/2026");
        // Header footer checksum covers the date payload including its NUL terminator.
        let checksum = bytes[offset..offset + 11]
            .iter()
            .fold(0u16, |sum, b| sum.wrapping_add(*b as u16));
        bytes[offset + 16..offset + 18].copy_from_slice(&checksum.to_le_bytes());
        let file = p.join(format!("{n}.xrk"));
        fs::write(&file, bytes).unwrap();
        ids.push(lib.import(&file).unwrap().id);
    }
    (p, lib, ids)
}
fn create(lib: &mut Library, ids: &[String]) -> String {
    let p = lib.preview_merge(ids).unwrap();
    lib.merge(ids, &p.preview_version, true).unwrap().id
}
#[test]
fn merge_reopen_unmerge_preserves_originals() {
    let (p, mut lib, ids) = setup("restore");
    for id in &ids {
        lib.save_workspace(
            id,
            json!({"axis":"time","video":{"version":999,"opaque":"preserved"}}),
        )
        .unwrap();
    }
    let before: Vec<_> = lib
        .snapshot()
        .unwrap()
        .entries
        .iter()
        .map(|e| (e.id.clone(), e.workspace.clone()))
        .collect();
    let id = create(&mut lib, &ids);
    let s = lib.load(&id).unwrap();
    assert_eq!(s.laps.len(), 24);
    assert!(s.channels.iter().all(|c| c.times.is_empty()));
    let text = fs::read_to_string(p.join("store/library.json")).unwrap();
    assert!(!text.contains("\"values\""));
    assert!(!text.contains("\"times\""));
    let mut lib = Library::open(p.join("store")).unwrap();
    assert_eq!(lib.snapshot().unwrap().active_session_id, Some(id.clone()));
    assert_eq!(lib.load(&id).unwrap().laps.len(), 24);
    let snapshot = lib.unmerge(&id).unwrap();
    assert_eq!(snapshot.entries.len(), 2);
    for (id, w) in before {
        assert_eq!(
            snapshot
                .entries
                .iter()
                .find(|e| e.id == id)
                .unwrap()
                .workspace,
            w
        );
    }
    assert!(lib.save_workspace(&id, json!({})).is_err());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn merge_missing_locate() {
    let (p, mut lib, ids) = setup("missing");
    let id = create(&mut lib, &ids);
    fs::rename(p.join("361.xrk"), p.join("moved.xrk")).unwrap();
    assert_eq!(
        lib.snapshot()
            .unwrap()
            .entries
            .iter()
            .find(|e| e.id == id)
            .unwrap()
            .status,
        "missing"
    );
    assert!(lib.load(&id).is_err());
    lib.locate(&ids[0], &p.join("moved.xrk")).unwrap();
    assert!(lib.load(&id).is_ok());
    fs::remove_file(p.join("moved.xrk")).unwrap();
    assert!(lib.unmerge(&id).is_ok());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn merge_stale_preview() {
    let (p, mut lib, ids) = setup("stale");
    let preview = lib.preview_merge(&ids).unwrap();
    assert!(lib.merge(&ids, &preview.preview_version, false).is_err());
    let mut bytes = fs::read(p.join("361.xrk")).unwrap();
    bytes[0] ^= 1;
    fs::write(p.join("361.xrk"), bytes).unwrap();
    assert!(lib.merge(&ids, &preview.preview_version, true).is_err());
    assert_eq!(lib.snapshot().unwrap().entries.len(), 2);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn merge_dependency_policy() {
    let (p, mut lib, ids) = setup("dependencies");
    let id = create(&mut lib, &ids);
    assert!(lib.remove(&ids[0]).is_err());
    assert!(lib.refresh(&ids[0]).is_ok());
    let bytes = fs::read(p.join("362.xrk")).unwrap();
    fs::write(p.join("361.xrk"), bytes).unwrap();
    assert!(lib.refresh(&ids[0]).unwrap_err().contains("Unmerge"));
    lib.unmerge(&id).unwrap();
    assert!(lib.remove(&ids[0]).is_ok());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn merge_schema_recovery() {
    let (p, mut lib, ids) = setup("schema");
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(p.join("store/library.json")).unwrap()).unwrap()
            ["version"],
        1
    );
    let id = create(&mut lib, &ids);
    lib.save_workspace(&id, json!({"axis":"time"})).unwrap();
    let primary = p.join("store/library.json");
    let saved = fs::read(&primary).unwrap();
    let mut value: Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(value["version"], 2);
    fs::write(p.join("store/library.tmp"), b"interrupted").unwrap();
    assert!(Library::open(p.join("store")).is_ok());
    for bad in [
        json!({"sessionId":"missing","contentVersion":"a".repeat(64)}),
        json!({"sessionId":id,"contentVersion":"bad"}),
    ] {
        let mut v = value.clone();
        v["merges"][0]["sources"][0] = bad;
        fs::write(&primary, serde_json::to_vec(&v).unwrap()).unwrap();
        assert!(!Library::open(p.join("store"))
            .unwrap()
            .snapshot()
            .unwrap()
            .warnings
            .is_empty());
    }
    value["version"] = json!(999);
    fs::write(&primary, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(Library::open(p.join("store")).is_err());
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(&primary).unwrap()).unwrap()["version"],
        999
    );
    fs::write(&primary, b"damaged").unwrap();
    assert!(!Library::open(p.join("store"))
        .unwrap()
        .snapshot()
        .unwrap()
        .warnings
        .is_empty());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn merge_settings_bounds() {
    let (p, mut lib, ids) = setup("bounds");
    let id = create(&mut lib, &ids);
    lib.save_workspace(&id, json!({"retained":true})).unwrap();
    assert!(lib
        .save_workspace(&id, json!({"big":"x".repeat(65536)}))
        .is_err());
    assert_eq!(
        lib.snapshot()
            .unwrap()
            .entries
            .iter()
            .find(|e| e.id == id)
            .unwrap()
            .workspace
            .as_ref()
            .unwrap()["retained"],
        true
    );
    assert!(lib
        .save_workspace_version(&id, json!({}), &"0".repeat(64))
        .is_err());
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn cross_source_formulas() {
    let (p, mut lib, ids) = setup("formulas");
    let id = create(&mut lib, &ids);
    let merged = lib.load(&id).unwrap();
    let info = merged.merge.as_ref().unwrap();
    let primary = info
        .preview
        .laps
        .iter()
        .find(|l| l.source_session_id == ids[0] && l.lap.complete)
        .unwrap();
    let comparison = info
        .preview
        .laps
        .iter()
        .find(|l| l.source_session_id == ids[1] && l.lap.complete)
        .unwrap();
    let channel = info
        .preview
        .channels
        .iter()
        .find(|c| c.source_session_id == ids[0] && c.channel.name.to_lowercase().contains("rpm"))
        .unwrap();
    let f = vec![apex_telemetry::telemetry::expressions::Formula {
        id: "derived".into(),
        name: "RPM plus".into(),
        expression: format!("[{}]+10{{rpm}}", channel.channel.id),
    }];
    assert!(lib.validate_formulas(&id, &f).is_ok());
    let a = lib
        .analyze_formulas(
            &id,
            &primary.lap.id,
            Some(&comparison.lap.id),
            "time",
            &["derived".into()],
            &f,
        )
        .unwrap();
    assert!(!a.primary.series[0].values.is_empty());
    assert!(!a.comparison.unwrap().series[0].values.is_empty());
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn merged_corner_reset_inheritance() {
    let (p, mut lib, ids) = setup("corners");
    let original = lib.load(&ids[0]).unwrap();
    let lap = original.laps.iter().find(|l| l.complete).unwrap();
    let automatic = lib
        .analyze(&ids[0], &lap.id, None, "distance", &[])
        .unwrap();
    let mut boundaries: Vec<_> = automatic
        .segments
        .iter()
        .skip(1)
        .map(|s| s.start_meters)
        .collect();
    boundaries[0] += 1.;
    lib.set_corner_boundaries(&ids[0], &lap.id, Some(boundaries.clone()))
        .unwrap();
    let id = create(&mut lib, &ids);
    let q = apex_telemetry::merging::qualified_lap_id(&ids[0], &lap.id);
    assert_eq!(
        lib.analyze(&id, &q, None, "distance", &[])
            .unwrap()
            .corner_boundaries,
        Some(boundaries.clone())
    );
    lib.set_corner_boundaries(&id, &q, None).unwrap();
    assert_eq!(
        lib.analyze(&id, &q, None, "distance", &[])
            .unwrap()
            .corner_boundaries,
        None
    );
    lib.unmerge(&id).unwrap();
    assert_eq!(
        lib.analyze(&ids[0], &lap.id, None, "distance", &[])
            .unwrap()
            .corner_boundaries,
        Some(boundaries)
    );
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn merge_flattens_existing_merges_and_deduplicates_originals() {
    let (p, mut lib, ids) = setup("flatten");
    let first = create(&mut lib, &ids);
    lib.save_workspace(
        &first,
        json!({"axis":"time", "sourceVideos":{ids[0].clone():{"opaque":"merge-video"}}}),
    )
    .unwrap();
    let preview = lib.preview_merge(&[first.clone(), ids[0].clone()]).unwrap();
    assert_eq!(preview.sources.len(), 2);
    assert!(preview.sources.iter().all(|s| ids.contains(&s.session_id)));
    let second = create(&mut lib, &[first.clone(), ids[0].clone()]);
    assert_eq!(lib.load(&second).unwrap().laps.len(), 24);
    let snapshot = lib.snapshot().unwrap();
    let workspace = snapshot
        .entries
        .iter()
        .find(|e| e.id == second)
        .unwrap()
        .workspace
        .as_ref()
        .unwrap();
    assert_eq!(workspace["sourceVideos"][&ids[0]]["opaque"], "merge-video");
    lib.unmerge(&first).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    assert_eq!(lib.load(&second).unwrap().merge.unwrap().sources.len(), 2);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn merge_reopen_keeps_stored_identity_when_preview_algorithm_changes() {
    let (p, mut lib, ids) = setup("legacy-identity");
    let id = create(&mut lib, &ids);
    let manifest = p.join("store/library.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    // An older release hashes its preview differently, while the original source hashes agree.
    let legacy_version = "b".repeat(64);
    value["merges"][0]["contentVersion"] = json!(legacy_version);
    value["merges"][0]["workspace"]["contentVersion"] = json!(legacy_version);
    fs::write(&manifest, serde_json::to_vec(&value).unwrap()).unwrap();
    let mut lib = Library::open(p.join("store")).unwrap();
    assert_eq!(lib.load(&id).unwrap().laps.len(), 24);
    assert_eq!(
        lib.snapshot()
            .unwrap()
            .entries
            .iter()
            .find(|e| e.id == id)
            .unwrap()
            .content_version,
        legacy_version
    );
    assert_eq!(
        lib.snapshot()
            .unwrap()
            .entries
            .iter()
            .find(|e| e.id == id)
            .unwrap()
            .workspace
            .as_ref()
            .unwrap()["contentVersion"],
        legacy_version
    );
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn remerge_preserves_video_mappings_from_every_selected_merge() {
    let (p, mut lib, ids) = setup("merge-videos");
    let first = create(&mut lib, &ids);
    lib.save_workspace(&first, json!({"sourceVideos":{ids[0].clone():{"opaque":"first-a"}, ids[1].clone():{"opaque":"first-b"}}})).unwrap();
    let mut more = vec![];
    for n in [361, 362] {
        let mut bytes = fs::read(p.join(format!("{n}.xrk"))).unwrap();
        let offset = bytes.windows(10).position(|s| s == b"10/14/2026").unwrap();
        bytes[offset..offset + 10].copy_from_slice(b"10/15/2026");
        let checksum = bytes[offset..offset + 11]
            .iter()
            .fold(0u16, |sum, b| sum.wrapping_add(*b as u16));
        bytes[offset + 16..offset + 18].copy_from_slice(&checksum.to_le_bytes());
        let path = p.join(format!("later-{n}.xrk"));
        fs::write(&path, bytes).unwrap();
        more.push(lib.import(&path).unwrap().id);
    }
    let second = create(
        &mut lib,
        &[ids[0].clone(), more[0].clone(), more[1].clone()],
    );
    lib.save_workspace(&second, json!({"sourceVideos":{ids[0].clone():{"opaque":"active-a"}, more[0].clone():{"opaque":"second-c"}, more[1].clone():{"opaque":"second-d"}}})).unwrap();
    let combined = create(&mut lib, &[first, second]);
    let snapshot = lib.snapshot().unwrap();
    let videos = &snapshot
        .entries
        .iter()
        .find(|e| e.id == combined)
        .unwrap()
        .workspace
        .as_ref()
        .unwrap()["sourceVideos"];
    assert_eq!(videos[&ids[0]]["opaque"], "active-a");
    assert_eq!(videos[&ids[1]]["opaque"], "first-b");
    assert_eq!(videos[&more[0]]["opaque"], "second-c");
    assert_eq!(videos[&more[1]]["opaque"], "second-d");
    assert_eq!(lib.load(&combined).unwrap().laps.len(), 48);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn merged_coach_analyzes_all_source_laps_as_one_session() {
    let (p, mut lib, ids) = setup("coach-combined");
    let originals: Vec<_> = ids.iter().map(|id| lib.load(id).unwrap()).collect();
    let complete_laps = originals
        .iter()
        .flat_map(|s| &s.laps)
        .filter(|l| l.complete)
        .count();
    let merged_id = create(&mut lib, &ids);
    let (input, _, boundaries) = lib
        .coach_input(&merged_id, None)
        .expect("Merged sessions must be accepted as a single Driving Coach analysis input");
    assert_eq!(input.id, merged_id);
    assert_eq!(input.laps.len(), 24);
    for source in &originals {
        let snapshot = &input
            .merge
            .as_ref()
            .unwrap()
            .sources
            .iter()
            .find(|s| s.reference.session_id == source.id)
            .unwrap()
            .session;
        for channel in &source.channels {
            let copied = snapshot
                .channels
                .iter()
                .find(|c| c.id == channel.id)
                .unwrap();
            assert_eq!(
                copied.times, channel.times,
                "Original sample timestamps must survive"
            );
            assert_eq!(
                copied.values, channel.values,
                "Original samples must survive"
            );
        }
        for lap in &source.laps {
            let qualified = serde_json::to_string(&(&source.id, &lap.id)).unwrap();
            assert!(
                input.laps.iter().any(|l| l.id == qualified),
                "Missing source lap {qualified}"
            );
        }
    }
    let report = apex_telemetry::coach::analysis::analyze(&input, None, boundaries.as_deref())
        .expect("Merged coaching must analyze the combined recordings");
    assert_eq!(report.session_id, merged_id);
    assert_eq!(report.consistency.sample_count, complete_laps);
    assert_eq!(report.valid_lap_count, complete_laps);
    let fastest = originals
        .iter()
        .flat_map(|s| &s.laps)
        .filter(|l| l.complete)
        .min_by(|a, b| a.duration.total_cmp(&b.duration))
        .unwrap();
    assert_eq!(report.best_lap_seconds, fastest.duration);
    assert_eq!(report.laps.len(), complete_laps);
    let physics = report
        .full_lap
        .as_ref()
        .expect("Merged full-lap physics must run");
    let range = physics
        .modeled_lap_seconds
        .as_ref()
        .expect("Fixture supports full-lap optimization");
    assert!(range.lower_seconds > 0. && range.upper_seconds >= range.lower_seconds);
    assert_eq!(physics.validation.feasibility_violations, 0);
    assert!(physics.rejection_reasons.is_empty());
    for source in &originals {
        assert!(
            physics
                .validation
                .training_lap_ids
                .iter()
                .any(|id| apex_telemetry::merging::split_id(id).unwrap().0 == source.id),
            "Every compatible recording must contribute to physics calibration"
        );
    }
    let known_laps: Vec<_> = input.laps.iter().map(|l| &l.id).collect();
    assert!(report
        .segments
        .iter()
        .all(|s| known_laps.contains(&&s.lap_id)));
    let known_channels: Vec<_> = input.channels.iter().map(|c| &c.id).collect();
    assert!(
        report
            .opportunities
            .iter()
            .flat_map(|o| &o.evidence)
            .chain(report.section_assessments.iter().flat_map(|s| &s.evidence))
            .flat_map(|e| &e.channel_ids)
            .all(|id| known_channels.contains(&id)),
        "Coaching evidence must retain source-qualified channel provenance"
    );
    assert!(report
        .opportunities
        .iter()
        .all(|o| known_laps.contains(&&o.lap_id) && known_laps.contains(&&o.reference_lap_id)));
    println!("Merged coaching: {} total laps, {} valid laps reviewed, {} spatial comparisons, {} excluded/incomplete; fastest {:.3}s, theoretical {:?}, modeled {:?}",
        input.laps.len(), report.valid_lap_count,
        report.laps.iter().filter(|l| l.spatial_comparison).count(),
        report.excluded_laps.len(), report.best_lap_seconds, report.theoretical_best_seconds,
        report.full_lap.as_ref().and_then(|f| f.modeled_lap_seconds.as_ref()));
    // Reopening retains source resolution and cache identity; unmerge restores originals.
    let (_, version, _) = lib.coach_input(&merged_id, None).unwrap();
    let service = apex_telemetry::coach::service::CoachService::default();
    let job = service.begin("merged-regression").unwrap();
    let result =
        apex_telemetry::coach::service::explain(report, &p.join("absent-model.gguf"), &job, false)
            .unwrap();
    assert_eq!(result.mode, "deterministic");
    assert_eq!(result.report.session_id, merged_id);
    let key =
        apex_telemetry::coach::service::cache_key(&version, None, boundaries.as_deref(), false)
            .unwrap();
    service.remember(key.clone(), result);
    let cached = service.cached(&key).unwrap();
    assert!(cached.cached);
    assert_eq!(cached.report.valid_lap_count, complete_laps);
    drop(lib);
    let mut lib = Library::open(p.join("store")).unwrap();
    let (reopened, reopened_version, _) = lib.coach_input(&merged_id, None).unwrap();
    assert_eq!(reopened_version, version);
    assert_eq!(reopened.laps.len(), 24);
    assert!(lib
        .load(&merged_id)
        .unwrap()
        .channels
        .iter()
        .all(|c| c.times.is_empty()));
    lib.unmerge(&merged_id).unwrap();
    assert!(lib.coach_input(&merged_id, None).is_err());
    for original in originals {
        let (restored, _, _) = lib.coach_input(&original.id, None).unwrap();
        assert!(restored.merge.is_none());
        assert_eq!(restored.laps.len(), original.laps.len());
        assert_eq!(restored.channels[0].times, original.channels[0].times);
        assert_eq!(restored.channels[0].values, original.channels[0].values);
    }
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn merged_coach_inherits_fastest_source_corners_and_honors_reset() {
    let (p, mut lib, ids) = setup("coach-corners");
    let sources: Vec<_> = ids.iter().map(|id| lib.load(id).unwrap()).collect();
    let (source, lap) = sources
        .iter()
        .flat_map(|s| s.laps.iter().map(move |l| (s, l)))
        .filter(|(_, l)| l.complete)
        .min_by(|(_, a), (_, b)| a.duration.total_cmp(&b.duration))
        .unwrap();
    let analysis = lib
        .analyze(&source.id, &lap.id, None, "distance", &[])
        .unwrap();
    let mut boundaries: Vec<_> = analysis
        .segments
        .iter()
        .skip(1)
        .map(|s| s.start_meters)
        .collect();
    boundaries[0] += 1.;
    lib.set_corner_boundaries(&source.id, &lap.id, Some(boundaries.clone()))
        .unwrap();
    let merged = create(&mut lib, &ids);
    assert_eq!(
        lib.coach_input(&merged, None).unwrap().2,
        Some(boundaries.clone())
    );
    let qualified = apex_telemetry::merging::qualified_lap_id(&source.id, &lap.id);
    lib.set_corner_boundaries(&merged, &qualified, None)
        .unwrap();
    assert_eq!(lib.coach_input(&merged, None).unwrap().2, None);
    lib.unmerge(&merged).unwrap();
    assert_eq!(
        lib.coach_input(&source.id, None).unwrap().2,
        Some(boundaries)
    );
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn merged_details_round_trip_independently_of_sources_and_workspace() {
    let (p, mut lib, ids) = setup("details");
    let id = create(&mut lib, &ids);
    let before = lib.snapshot().unwrap();
    let original = before.entries.iter().find(|e| e.id == id).unwrap().clone();
    lib.update_details(&id, "Race day", "Alex", "2026-10-23")
        .unwrap();
    let loaded = lib.load(&id).unwrap();
    assert_eq!(loaded.name, "Race day");
    assert_eq!(loaded.recorded_at, "2026-10-23");
    drop(lib);
    let mut lib = Library::open(p.join("store")).unwrap();
    let loaded = lib.load(&id).unwrap();
    assert_eq!(loaded.driver, "Alex");
    assert_eq!(loaded.recorded_at, "2026-10-23");
    let after = lib.snapshot().unwrap();
    let entry = after.entries.iter().find(|e| e.id == id).unwrap();
    assert_eq!(entry.content_version, original.content_version);
    assert_eq!(entry.workspace, original.workspace);
    assert_eq!(entry.merge_sources.as_ref().unwrap().len(), 2);
    for source_id in &ids {
        let previous = before.entries.iter().find(|e| e.id == *source_id).unwrap();
        let current = after.entries.iter().find(|e| e.id == *source_id).unwrap();
        assert_eq!(current.name, previous.name);
        assert_eq!(current.driver, previous.driver);
        assert_eq!(current.recorded_at, previous.recorded_at);
    }
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn date_only_source_edits_sort_chronologically_and_invalidate_pending_previews() {
    let (p, mut lib, ids) = setup("details-date-order");
    let preview = lib.preview_merge(&ids).unwrap();
    lib.update_details(&ids[1], "Earlier run", "Alex", "2024-02-29")
        .unwrap();
    assert!(lib.merge(&ids, &preview.preview_version, true).is_err());
    let next = lib.preview_merge(&ids).unwrap();
    assert_eq!(next.day, "2024-02-29");
    assert_eq!(next.laps[0].source_session_id, ids[1]);
    assert_eq!(
        apex_telemetry::merging::parse_recording_stamp("2024-02-29")
            .unwrap()
            .seconds_from_midnight,
        0
    );
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn source_date_edits_preserve_saved_merge_lap_numbers_after_reopen() {
    let (p, mut lib, ids) = setup("details-saved-order");
    let id = create(&mut lib, &ids);
    let before = lib.load(&id).unwrap();
    let first = before.merge.as_ref().unwrap().preview.sources[0]
        .session_id
        .clone();
    lib.update_details(&first, "Later run", "Alex", "2029-10-23")
        .unwrap();
    let after = lib.load(&id).unwrap();
    assert_eq!(
        before.laps.iter().map(|l| &l.id).collect::<Vec<_>>(),
        after.laps.iter().map(|l| &l.id).collect::<Vec<_>>()
    );
    assert_eq!(
        before
            .merge
            .as_ref()
            .unwrap()
            .preview
            .laps
            .iter()
            .map(|l| l.display_number)
            .collect::<Vec<_>>(),
        after
            .merge
            .as_ref()
            .unwrap()
            .preview
            .laps
            .iter()
            .map(|l| l.display_number)
            .collect::<Vec<_>>()
    );
    drop(lib);
    let mut lib = Library::open(p.join("store")).unwrap();
    let restored = lib.load(&id).unwrap();
    assert_eq!(
        before.laps.iter().map(|l| &l.id).collect::<Vec<_>>(),
        restored.laps.iter().map(|l| &l.id).collect::<Vec<_>>()
    );
    assert_ne!(
        lib.preview_merge(&ids).unwrap().sources[0].session_id,
        first
    );
    fs::remove_dir_all(p).unwrap();
}
