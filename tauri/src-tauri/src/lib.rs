//! KeyCount desktop agent: counts keystrokes and clicks, stores them in the
//! same SQLite file as the Python agent, and syncs to the backend.

pub mod appdetect;
pub mod hooks;
pub mod keys_server;
pub mod store;
pub mod sync;
pub mod tracker;

use hooks::{HookStatus, Sink};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use store::Store;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tracker::{now_secs, Tracker};

const SYNC_INTERVAL: Duration = Duration::from_secs(60);
const SYNC_BATCH: i64 = 500;
const DASHBOARD_URL: &str = "https://key-count.vercel.app/app";

#[derive(Default, Clone)]
struct SyncInfo {
    at: Option<f64>,
    synced: usize,
    error: Option<String>,
}

struct AppState {
    store: Arc<Store>,
    tracker: Arc<Tracker>,
    hook: Arc<Mutex<HookStatus>>,
    keys_error: Arc<Mutex<Option<String>>>,
    last_sync: Arc<Mutex<SyncInfo>>,
    db_path: String,
}

/// Feeds raw input events into the tracker.
struct TrackerSink(Arc<Tracker>);

impl Sink for TrackerSink {
    fn key(&self, label: &str) {
        self.0.on_key(label, now_secs());
    }
    fn click(&self) {
        self.0.on_click(now_secs());
    }
    fn motion(&self, x: f64, y: f64) {
        self.0.on_move(x, y, now_secs());
    }
}

fn backend_url(store: &Store) -> String {
    store
        .get_setting("backend_url")
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| sync::DEFAULT_BACKEND_URL.to_string())
}

fn run_sync(state: &AppState) -> SyncInfo {
    let info = match state.store.get_setting("device_token").filter(|t| !t.is_empty()) {
        None => SyncInfo { at: None, synced: 0, error: Some("Not signed in yet.".into()) },
        Some(token) => {
            let (n, err) = sync::sync_once(&state.store, &backend_url(&state.store), &token, SYNC_BATCH);
            SyncInfo { at: Some(now_secs()), synced: n, error: err }
        }
    };
    if let Ok(mut g) = state.last_sync.lock() {
        *g = info.clone();
    }
    info
}

fn hook_json(h: &HookStatus) -> Value {
    match h {
        HookStatus::Starting => json!({ "state": "starting" }),
        HookStatus::Running => json!({ "state": "running" }),
        HookStatus::NeedsPermission(m) => json!({ "state": "needs_permission", "message": m }),
        HookStatus::Failed(m) => json!({ "state": "failed", "message": m }),
        HookStatus::Unsupported => json!({ "state": "unsupported" }),
    }
}

#[tauri::command]
fn get_status(app: AppHandle, state: State<'_, AppState>) -> Value {
    let today = state.tracker.today(now_secs());
    let hook = state.hook.lock().map(|h| hook_json(&h)).unwrap_or(json!({ "state": "failed" }));
    let sync_info = state.last_sync.lock().map(|g| g.clone()).unwrap_or_default();
    let keys_error = state.keys_error.lock().ok().and_then(|g| g.clone());
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "keystrokes": today.keystrokes,
        "clicks": today.clicks,
        "active": today.active,
        "hook": hook,
        "registered": state.store.get_setting("device_token").map(|t| !t.is_empty()).unwrap_or(false),
        "dashboard_url": DASHBOARD_URL,
        "account": state.store.get_setting("account_name").filter(|n| !n.is_empty()),
        "last_sync": { "at": sync_info.at, "synced": sync_info.synced, "error": sync_info.error },
        "keys_error": keys_error,
        "tracker_error": state.tracker.last_error(),
        "access_code": state.store.local_token(),
        "db_path": state.db_path,
        "autostart": autostart,
    })
}

#[tauri::command(async)]
fn register(
    state: State<'_, AppState>,
    has_account: bool,
    email: String,
    password: String,
    username: Option<String>,
) -> Result<String, String> {
    let msg = sync::register_device(&state.store, &backend_url(&state.store), has_account, email.trim(), &password, username.as_deref())?;
    run_sync(&state);
    Ok(msg)
}

#[tauri::command(async)]
fn sync_now(state: State<'_, AppState>) -> Value {
    let info = run_sync(&state);
    json!({ "at": info.at, "synced": info.synced, "error": info.error })
}

/// Forgets the device token so syncing stops until the user signs in again.
/// Counted data stays on this computer and uploads after the next sign in.
#[tauri::command]
fn sign_out(state: State<'_, AppState>) -> Result<(), String> {
    state.store.set_setting("device_token", "").map_err(|e| e.to_string())?;
    state.store.set_setting("account_name", "").map_err(|e| e.to_string())?;
    if let Ok(mut g) = state.last_sync.lock() {
        *g = SyncInfo::default();
    }
    Ok(())
}

#[tauri::command]
fn open_dashboard(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(DASHBOARD_URL, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())?;
    } else {
        manager.disable().map_err(|e| e.to_string())?;
    }
    manager.is_enabled().map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn spawn_background(state: &AppState, current_app: Arc<RwLock<String>>) {
    // Foreground-app watcher: hook callbacks read this, never the OS.
    let tracker = state.tracker.clone();
    std::thread::Builder::new()
        .name("keycount-app-watch".into())
        .spawn(move || loop {
            let app = appdetect::foreground_app();
            if let Ok(mut g) = current_app.write() {
                if *g != app {
                    *g = app;
                }
            }
            let idle = tracker.idle_for(now_secs());
            std::thread::sleep(Duration::from_millis(if idle > 5.0 { 1000 } else { 150 }));
        })
        .ok();

    let tracker = state.tracker.clone();
    std::thread::Builder::new()
        .name("keycount-tick".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            tracker.tick(now_secs());
        })
        .ok();
}

pub fn run() {
    let db_path = store::default_db_path();
    if let Some(dir) = db_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let store = Arc::new(Store::open(&db_path).expect("could not open the KeyCount database"));
    let current_app = Arc::new(RwLock::new(String::from("unknown")));
    let tracker = Arc::new(Tracker::new(store.clone(), current_app.clone(), now_secs()));

    let state = AppState {
        store: store.clone(),
        tracker: tracker.clone(),
        hook: Arc::new(Mutex::new(HookStatus::Starting)),
        keys_error: Arc::new(Mutex::new(None)),
        last_sync: Arc::new(Mutex::new(SyncInfo::default())),
        db_path: db_path.display().to_string(),
    };

    // Input hooks.
    let hook_slot = state.hook.clone();
    hooks::start(
        Arc::new(TrackerSink(tracker.clone())),
        Arc::new(move |s| {
            if let Ok(mut g) = hook_slot.lock() {
                *g = s;
            }
        }),
    );

    // Local keys API for the dashboard.
    match keys_server::start(store.clone(), keys_server::LOCAL_API_PORT) {
        Ok(_server) => {}
        Err(e) => {
            if let Ok(mut g) = state.keys_error.lock() {
                *g = Some(e);
            }
        }
    }

    spawn_background(&state, current_app);

    // Periodic sync.
    {
        let store = store.clone();
        let last_sync = state.last_sync.clone();
        std::thread::Builder::new()
            .name("keycount-sync".into())
            .spawn(move || loop {
                std::thread::sleep(SYNC_INTERVAL);
                if let Some(token) = store.get_setting("device_token").filter(|t| !t.is_empty()) {
                    let (n, err) = sync::sync_once(&store, &backend_url(&store), &token, SYNC_BATCH);
                    if let Ok(mut g) = last_sync.lock() {
                        *g = SyncInfo { at: Some(now_secs()), synced: n, error: err };
                    }
                }
            })
            .ok();
    }

    let start_hidden = std::env::args().any(|a| a == "--hidden");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(state)
        .invoke_handler(tauri::generate_handler![get_status, register, sync_now, sign_out, open_dashboard, set_autostart])
        .setup(move |app| {
            let show = MenuItem::with_id(app, "show", "Open KeyCount", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("KeyCount")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if !start_hidden {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building KeyCount");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.tracker.shutdown(now_secs());
            }
        }
    });
}
