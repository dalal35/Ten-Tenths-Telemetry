pub mod coach;
#[cfg(any(windows, test))]
mod desktop;
pub mod library;
pub mod merging;
mod persistence;
pub mod telemetry;
pub mod video;
pub mod video_analysis;
pub mod youtube;

use library::{Library, LibrarySnapshot};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use telemetry::{Analysis, Session};
type Store = Arc<Mutex<Result<Library, String>>>;

// Parsing, hashing, analysis and disk writes never run on the WebView/UI thread.
// One serialized owner keeps manifest generations and workspace mutations ordered.
async fn task<T: Send + 'static>(
    store: &Store,
    operation: impl FnOnce(&mut Library) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let store = store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = store
            .lock()
            .map_err(|_| "Local library storage unavailable")?;
        let library = guard.as_mut().map_err(|e| e.clone())?;
        operation(library)
    })
    .await
    .map_err(|e| format!("Local library operation failed: {e}"))?
}
#[tauri::command]
async fn preview_merge_sessions(
    session_ids: Vec<String>,
    state: State<'_, Store>,
) -> Result<merging::MergePreview, String> {
    task(state.inner(), move |library| {
        library.preview_merge(&session_ids)
    })
    .await
}
#[tauri::command]
async fn merge_sessions(
    session_ids: Vec<String>,
    preview_version: String,
    acknowledge_warnings: bool,
    state: State<'_, Store>,
) -> Result<Session, String> {
    task(state.inner(), move |library| {
        library.merge(&session_ids, &preview_version, acknowledge_warnings)
    })
    .await
}
#[tauri::command]
async fn unmerge_session(
    session_id: String,
    state: State<'_, Store>,
) -> Result<LibrarySnapshot, String> {
    task(state.inner(), move |library| library.unmerge(&session_id)).await
}
#[tauri::command]
async fn library_snapshot(state: State<'_, Store>) -> Result<LibrarySnapshot, String> {
    task(state.inner(), |library| library.snapshot()).await
}
#[tauri::command]
async fn import_session(path: String, state: State<'_, Store>) -> Result<Session, String> {
    task(state.inner(), move |library| {
        library.import(&PathBuf::from(path))
    })
    .await
}
#[tauri::command]
async fn load_library_session(
    session_id: String,
    state: State<'_, Store>,
) -> Result<Session, String> {
    task(state.inner(), move |library| library.load(&session_id)).await
}
#[tauri::command]
async fn update_library_details(
    session_id: String,
    name: String,
    driver: String,
    recorded_at: String,
    state: State<'_, Store>,
) -> Result<library::LibraryEntry, String> {
    task(state.inner(), move |library| {
        library.update_details(&session_id, &name, &driver, &recorded_at)
    })
    .await
}
#[tauri::command]
async fn remove_library_session(
    session_id: String,
    state: State<'_, Store>,
) -> Result<LibrarySnapshot, String> {
    task(state.inner(), move |library| library.remove(&session_id)).await
}
#[tauri::command]
async fn refresh_library_session(
    session_id: String,
    state: State<'_, Store>,
) -> Result<Session, String> {
    task(state.inner(), move |library| library.refresh(&session_id)).await
}
#[tauri::command]
async fn locate_library_session(
    session_id: String,
    path: String,
    state: State<'_, Store>,
) -> Result<Session, String> {
    task(state.inner(), move |library| {
        library.locate(&session_id, &PathBuf::from(path))
    })
    .await
}
#[tauri::command]
async fn save_workspace(
    session_id: String,
    workspace: Value,
    expected_content_version: String,
    state: State<'_, Store>,
    videos: State<'_, youtube::YouTubeService>,
) -> Result<(), String> {
    let videos = videos.inner().clone();
    task(state.inner(), move |library| {
        library.save_workspace_version(&session_id, workspace, &expected_content_version)?;
        videos.protect_refs(&library.youtube_video_ids());
        Ok(())
    })
    .await
}
#[tauri::command]
async fn set_corner_boundaries(
    session_id: String,
    primary_id: String,
    boundaries: Option<Vec<f64>>,
    state: State<'_, Store>,
) -> Result<(), String> {
    task(state.inner(), move |library| {
        library.set_corner_boundaries(&session_id, &primary_id, boundaries)
    })
    .await
}
#[tauri::command]
async fn analyze_session(
    session_id: String,
    primary_id: String,
    comparison_id: Option<String>,
    axis: String,
    channel_ids: Vec<String>,
    formulas: Option<Vec<telemetry::expressions::Formula>>,
    state: State<'_, Store>,
) -> Result<Analysis, String> {
    task(state.inner(), move |library| {
        library.analyze_formulas(
            &session_id,
            &primary_id,
            comparison_id.as_deref(),
            &axis,
            &channel_ids,
            &formulas.unwrap_or_default(),
        )
    })
    .await
}
#[tauri::command]
async fn analyze_advanced(
    session_id: String,
    primary_id: String,
    comparison_id: Option<String>,
    axis: String,
    request: telemetry::advanced::AdvancedRequest,
    formulas: Vec<telemetry::expressions::Formula>,
    state: State<'_, Store>,
) -> Result<Value, String> {
    task(state.inner(), move |library| {
        library.analyze_advanced(
            &session_id,
            &primary_id,
            comparison_id.as_deref(),
            &axis,
            request,
            &formulas,
        )
    })
    .await
}
#[tauri::command]
async fn validate_formulas(
    session_id: String,
    formulas: Vec<telemetry::expressions::Formula>,
    state: State<'_, Store>,
) -> Result<Vec<Value>, String> {
    task(state.inner(), move |library| {
        library.validate_formulas(&session_id, &formulas)
    })
    .await
}
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(windows)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED,
            )
            .skip_initial_state("main")
            .build(),
    );
    builder
        .setup(|app| {
            let library = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Cannot locate local library folder: {e}"))
                .and_then(Library::open);
            #[cfg(windows)]
            if let Err(error) = desktop::restore(app) {
                eprintln!("Could not restore Windows window geometry: {error}");
            }
            // A damaged/unsupported library stays read-only and is reported to the UI.
            app.manage(Arc::new(Mutex::new(library)) as Store);
            app.manage(coach::service::CoachService::default());
            app.manage(youtube::YouTubeService::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_library_details,
            coach::commands::analyze_driving_coach,
            coach::commands::cancel_driving_coach,
            coach::commands::driving_coach_status,
            coach::commands::driving_coach_model_terms,
            video::authorize_local_video,
            youtube::download_youtube_video,
            youtube::resolve_cached_youtube_video,
            youtube::youtube_download_status,
            youtube::cancel_youtube_download,
            youtube::release_youtube_video,
            youtube::youtube_cache_status,
            youtube::set_youtube_cache_limit,
            youtube::clean_youtube_cache,
            youtube::remove_youtube_cache_entry,
            import_session,
            analyze_session,
            analyze_advanced,
            validate_formulas,
            library_snapshot,
            preview_merge_sessions,
            merge_sessions,
            unmerge_session,
            load_library_session,
            remove_library_session,
            refresh_library_session,
            locate_library_session,
            save_workspace,
            set_corner_boundaries
        ])
        .build(tauri::generate_context!())
        .expect("Could not launch Ten Tenths Telemetry")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                app.state::<youtube::YouTubeService>().shutdown();
            }
        });
}
