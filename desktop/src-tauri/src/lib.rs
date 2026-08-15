use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use rand::{distributions::Alphanumeric, Rng};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Settings {
    roots: Vec<String>,
    paused: bool,
    hotkey: String,
    theme: String,
    remember_query: bool,
    remember_pos: bool,
    window_pos: Option<Value>,
    opacity: f64,
    index_interval_sec: i64,
    max_file_size_mb: i64,
    unlimited_indexing: bool,
    schedule_enabled: bool,
    schedule_minutes: i64,
    ai_model: String,
    ai_provider: String,
    language: String,
    cloud_vendor: String,
    cloud_api_url: String,
    cloud_api_key: String,
    cloud_model: String,
    license_email: String,
    license_key: String,
    license_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct DesktopAuthData {
    pending_state: String,
    token: String,
    profile: Option<Value>,
    error: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            roots: vec![],
            paused: false,
            hotkey: "".to_string(),
            theme: "dark".to_string(),
            remember_query: true,
            remember_pos: false,
            window_pos: None,
            opacity: 0.92,
            index_interval_sec: 60,
            max_file_size_mb: 20,
            unlimited_indexing: false,
            schedule_enabled: true,
            schedule_minutes: 30,
            ai_model: "qwen2.5:1.5b".to_string(),
            ai_provider: "auto".to_string(),
            language: "".to_string(),
            cloud_vendor: "officeghost".to_string(),
            cloud_api_url: "https://www.officeghost.com/api/chat".to_string(),
            cloud_api_key: "".to_string(),
            cloud_model: "gpt-4o-mini".to_string(),
            license_email: "".to_string(),
            license_key: "".to_string(),
            license_status: "FREE".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IndexData {
    files: HashMap<String, Value>,
}

#[derive(Clone)]
struct AppState {
    index_status: Arc<Mutex<Value>>,
    index_cache: Arc<Mutex<IndexData>>,
    worker: Arc<Mutex<Option<Arc<Mutex<Child>>>>>,
    ai_status: Arc<Mutex<Value>>,
    app_update_status: Arc<Mutex<Value>>,
    duplicate_result: Arc<Mutex<Value>>,
    sort_running: Arc<Mutex<bool>>,
    last_schedule_run: Arc<Mutex<i64>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            index_status: Arc::new(Mutex::new(json!({
              "state": "idle",
              "scanned": 0,
              "total": 0,
              "fileCount": 0,
              "byExt": {},
              "scannedByExt": {}
            }))),
            index_cache: Arc::new(Mutex::new(IndexData::default())),
            worker: Arc::new(Mutex::new(None)),
            ai_status: Arc::new(Mutex::new(json!({
              "installed": false,
              "installing": false,
              "model": "qwen2.5:1.5b",
              "progress": "",
              "error": ""
            }))),
            app_update_status: Arc::new(Mutex::new(json!({
              "state": "idle",
              "available": false,
              "version": "",
              "downloading": false,
              "installed": false,
              "progress": 0,
              "error": ""
            }))),
            duplicate_result: Arc::new(Mutex::new(json!({
              "mode": "duplicates",
              "groups": [],
              "total": 0,
              "copies": 0
            }))),
            sort_running: Arc::new(Mutex::new(false)),
            last_schedule_run: Arc::new(Mutex::new(0)),
        }
    }
}

fn app_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

fn settings_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("settings.json"))
}

fn index_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("index.json"))
}

fn report_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("index-report.json"))
}

fn ai_state_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("ai-state.json"))
}

fn desktop_auth_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("desktop-auth.json"))
}

fn ensure_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
}

fn load_desktop_auth_internal(app: &tauri::AppHandle) -> DesktopAuthData {
    let Some(path) = desktop_auth_path(app) else {
        return DesktopAuthData::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<DesktopAuthData>(&raw).ok())
        .unwrap_or_default()
}

fn save_desktop_auth_internal(app: &tauri::AppHandle, auth: &DesktopAuthData) {
    let Some(path) = desktop_auth_path(app) else {
        return;
    };
    ensure_parent(&path);
    if fs::write(&path, serde_json::to_string_pretty(auth).unwrap_or_else(|_| "{}".to_string())).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }
    }
}

fn desktop_auth_status(auth: &DesktopAuthData) -> Value {
    let status = if !auth.token.is_empty() && auth.profile.is_some() {
        "authenticated"
    } else if !auth.pending_state.is_empty() {
        "waiting"
    } else if !auth.error.is_empty() {
        "error"
    } else {
        "signed_out"
    };
    json!({
      "authenticated": status == "authenticated",
      "status": status,
      "profile": auth.profile,
      "error": auth.error,
    })
}

fn emit_desktop_auth(app: &tauri::AppHandle, auth: &DesktopAuthData) {
    let _ = app.emit("desktop-auth-updated", desktop_auth_status(auth));
}

fn migrate_legacy_user_data(app: &tauri::AppHandle) {
    let Some(current_dir) = app_data_dir(app) else {
        return;
    };
    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return;
    }

    let legacy_dirs = vec![
        PathBuf::from(&home).join("Library/Application Support/OfficeGhost"),
        PathBuf::from(&home).join("Library/Application Support/AIAssistant"),
        PathBuf::from(&home).join("Library/Application Support/AI Assistant"),
        PathBuf::from(&home).join("Library/Application Support/ai-desktop-assistant"),
    ];

    let targets = vec![
        "index.json",
        "index-report.json",
        "settings.json",
        "ai-state.json",
    ];

    for legacy in legacy_dirs {
        if legacy == current_dir || !legacy.exists() {
            continue;
        }

        for name in &targets {
            let src = legacy.join(name);
            if !src.exists() {
                continue;
            }
            let dst = current_dir.join(name);
            if dst.exists() {
                continue;
            }
            if let Some(parent) = dst.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::copy(&src, &dst);
        }
    }
}

fn load_settings_internal(app: &tauri::AppHandle) -> Settings {
    fn detect_lang() -> String {
        let raw = std::env::var("LC_ALL")
            .or_else(|_| std::env::var("LANG"))
            .unwrap_or_default()
            .to_lowercase();
        if raw.starts_with("ru") {
            "ru".to_string()
        } else {
            "en".to_string()
        }
    }

    let Some(path) = settings_path(app) else {
        return Settings::default();
    };
    if !path.exists() {
        let mut st = Settings::default();
        st.language = detect_lang();
        return st;
    }
    match fs::read_to_string(path) {
        Ok(raw) => {
            let mut st = serde_json::from_str::<Settings>(&raw).unwrap_or_default();
            if st.hotkey.eq_ignore_ascii_case("CommandOrControl+1") || st.hotkey.eq_ignore_ascii_case("CmdOrCtrl+1") {
                st.hotkey.clear();
            }
            st.ai_provider = "auto".to_string();
            st.cloud_vendor = "officeghost".to_string();
            st.cloud_api_url = "https://www.officeghost.com/api/chat".to_string();
            if st.language.trim().is_empty() {
                st.language = detect_lang();
            }
            st
        }
        Err(_) => {
            let mut st = Settings::default();
            st.language = detect_lang();
            st
        }
    }
}

fn save_settings_internal(app: &tauri::AppHandle, settings: &Settings) {
    if let Some(path) = settings_path(app) {
        ensure_parent(&path);
        let _ = fs::write(
            path,
            serde_json::to_string_pretty(settings).unwrap_or_else(|_| "{}".to_string()),
        );
    }
}

fn is_ru(app: &tauri::AppHandle) -> bool {
    load_settings_internal(app)
        .language
        .eq_ignore_ascii_case("ru")
}

fn load_index_internal(app: &tauri::AppHandle) -> IndexData {
    let Some(path) = index_path(app) else {
        return IndexData::default();
    };
    if !path.exists() {
        return IndexData::default();
    }
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<IndexData>(&raw).unwrap_or_default(),
        Err(_) => IndexData::default(),
    }
}

fn refresh_index_cache(app: &tauri::AppHandle, state: &AppState) {
    let idx = load_index_internal(app);
    if let Ok(mut cache) = state.index_cache.lock() {
        *cache = idx;
    }
}

fn load_index_for_queries(app: &tauri::AppHandle, state: &AppState) -> IndexData {
    if let Ok(cache) = state.index_cache.lock() {
        if !cache.files.is_empty() {
            return cache.clone();
        }
    }

    let idx = load_index_internal(app);
    if !idx.files.is_empty() {
        if let Ok(mut cache) = state.index_cache.lock() {
            *cache = idx.clone();
        }
    }
    idx
}

fn open_target(path: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
}

fn get_default_roots() -> Vec<String> {
    let mut roots: Vec<String> = vec![];

    if let Ok(home) = std::env::var("HOME") {
        for p in [
            format!("{home}/Documents"),
            format!("{home}/Downloads"),
            format!("{home}/Desktop"),
        ] {
            if Path::new(&p).exists() && !roots.contains(&p) {
                roots.push(p);
            }
        }
    }

    if let Ok(profile) = std::env::var("USERPROFILE") {
        for p in [
            format!("{profile}\\Documents"),
            format!("{profile}\\Downloads"),
            format!("{profile}\\Desktop"),
        ] {
            if Path::new(&p).exists() && !roots.contains(&p) {
                roots.push(p);
            }
        }
    }

    roots
}

fn index_status_from_file(app: &tauri::AppHandle) -> Value {
    let index = load_index_internal(app);
    let mut by_ext: HashMap<String, i64> = HashMap::new();

    for (_k, v) in index.files.iter() {
        if let Some(ext) = v.get("ext").and_then(|x| x.as_str()) {
            let entry = by_ext.entry(ext.to_string()).or_insert(0);
            *entry += 1;
        }
    }

    let count = index.files.len() as i64;
    json!({
      "state": if count > 0 { "ready" } else { "idle" },
      "scanned": count,
      "total": count,
      "fileCount": count,
      "byExt": by_ext,
      "scannedByExt": by_ext
    })
}

fn set_and_emit_status(app: &tauri::AppHandle, state: &AppState, payload: Value) {
    if let Ok(mut s) = state.index_status.lock() {
        *s = payload.clone();
    }
    let _ = app.emit("index-status", payload);
}

fn find_rust_indexer_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("RUST_INDEXER") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    let mut candidates: Vec<PathBuf> = vec![];
    let bin = if cfg!(target_os = "windows") {
        "rust-indexer.exe"
    } else {
        "rust-indexer"
    };

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("../rust-indexer/target/release").join(bin));
        candidates.push(cwd.join("../rust-indexer/target/debug").join(bin));
        candidates.push(cwd.join("rust-indexer/target/release").join(bin));
        candidates.push(cwd.join("rust-indexer/target/debug").join(bin));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("rust-indexer"));
        candidates.push(resource_dir.join("rust-indexer.exe"));
        candidates.push(resource_dir.join("resources").join("rust-indexer"));
        candidates.push(resource_dir.join("resources").join("rust-indexer.exe"));
        candidates.push(resource_dir.join("release").join("rust-indexer"));
        candidates.push(resource_dir.join("release").join("rust-indexer.exe"));
        candidates.push(
            resource_dir
                .join("_up_")
                .join("rust-indexer")
                .join("target")
                .join("release")
                .join("rust-indexer"),
        );
        candidates.push(
            resource_dir
                .join("_up_")
                .join("rust-indexer")
                .join("target")
                .join("release")
                .join("rust-indexer.exe"),
        );
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("rust-indexer"));
            candidates.push(parent.join("rust-indexer.exe"));
            candidates.push(parent.join("release").join("rust-indexer"));
            candidates.push(parent.join("release").join("rust-indexer.exe"));
        }
    }

    for c in candidates {
        if c.exists() {
            return Some(c);
        }
    }

    None
}

fn start_indexing_internal(app: &tauri::AppHandle, state: &AppState, force_restart: bool) -> Value {
    let ru = is_ru(app);
    let has_worker = state
        .worker
        .lock()
        .ok()
        .and_then(|w| w.as_ref().cloned())
        .is_some();
    if has_worker && !force_restart {
        return state
            .index_status
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| json!({"state":"indexing"}));
    }

    if !force_restart {
        let existing = index_status_from_file(app);
        if existing.get("state").and_then(|x| x.as_str()) == Some("ready")
            && existing
                .get("fileCount")
                .and_then(|x| x.as_i64())
                .unwrap_or(0)
                > 0
        {
            set_and_emit_status(app, state, existing.clone());
            return existing;
        }
    }

    if has_worker && force_restart {
        let _ = pause_indexing_internal(app, state);
    }

    let Some(index_file) = index_path(app) else {
        let err = json!({"state":"error","lastError": if ru { "Не удалось определить путь index.json" } else { "Failed to resolve index.json path" }});
        set_and_emit_status(app, state, err.clone());
        return err;
    };

    ensure_parent(&index_file);

    let settings = load_settings_internal(app);
    let mut roots = settings.roots;
    roots.retain(|r| Path::new(r).exists());
    if roots.is_empty() {
        roots = get_default_roots();
    }
    if roots.is_empty() {
        let err = json!({"state":"error","lastError": if ru { "Нет доступных папок для индексации" } else { "No available folders to index" }});
        set_and_emit_status(app, state, err.clone());
        return err;
    }

    let Some(indexer_bin) = find_rust_indexer_path(app) else {
        let err = json!({"state":"error","lastError": if ru { "Не найден rust-indexer" } else { "rust-indexer was not found" }});
        set_and_emit_status(app, state, err.clone());
        return err;
    };

    let mut command = Command::new(indexer_bin);
    command
        .arg("index")
        .arg("--index")
        .arg(index_file.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    for root in roots.iter() {
        command.arg("--root").arg(root);
    }

    command.env(
        "INDEXER_MAX_FILE_SIZE_MB",
        settings.max_file_size_mb.max(1).to_string(),
    );
    if settings.unlimited_indexing {
        command.env("INDEXER_UNLIMITED", "1");
    } else {
        command.env("INDEXER_UNLIMITED", "0");
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            let err = json!({"state":"error","lastError": if ru { format!("Не удалось запустить indexer: {e}") } else { format!("Failed to start indexer: {e}") }});
            set_and_emit_status(app, state, err.clone());
            return err;
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child_arc = Arc::new(Mutex::new(child));
    if let Ok(mut w) = state.worker.lock() {
        *w = Some(child_arc.clone());
    }

    let start_payload = json!({
      "state": "indexing",
      "scanned": 0,
      "total": 0,
      "fileCount": 0,
      "byExt": {},
      "scannedByExt": {},
      "roots": roots,
    });
    set_and_emit_status(app, state, start_payload.clone());

    if let Some(out) = stdout {
        let app_handle = app.clone();
        let state_clone = state.clone();
        thread::spawn(move || {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(payload) = serde_json::from_str::<Value>(&line) {
                    if payload.get("type") == Some(&Value::String("throttle".to_string())) {
                        let _ = app_handle.emit("index-throttle", payload.clone());
                        continue;
                    }

                    if payload.get("type") == Some(&Value::String("progress".to_string())) {
                        let next = json!({
                          "state": "indexing",
                          "scanned": payload.get("scanned").cloned().unwrap_or(Value::from(0)),
                          "total": payload.get("total").cloned().unwrap_or(Value::from(0)),
                          "fileCount": payload.get("scanned").cloned().unwrap_or(Value::from(0)),
                          "byExt": payload.get("byExt").cloned().unwrap_or_else(|| json!({})),
                          "scannedByExt": payload.get("scannedByExt").cloned().unwrap_or_else(|| json!({}))
                        });
                        set_and_emit_status(&app_handle, &state_clone, next);
                        continue;
                    }

                    if payload.get("type") == Some(&Value::String("status".to_string())) {
                        if payload.get("state") == Some(&Value::String("ready".to_string())) {
                            refresh_index_cache(&app_handle, &state_clone);
                            let ready = index_status_from_file(&app_handle);
                            set_and_emit_status(&app_handle, &state_clone, ready);
                        }
                    }
                }
            }
        });
    }

    if let Some(err) = stderr {
        let app_handle = app.clone();
        let state_clone = state.clone();
        thread::spawn(move || {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                eprintln!("rust-indexer stderr: {line}");
                let payload = json!({"state":"error","lastError":line});
                set_and_emit_status(&app_handle, &state_clone, payload);
            }
        });
    }

    {
        let app_handle = app.clone();
        let state_clone = state.clone();
        thread::spawn(move || {
            let code = child_arc
                .lock()
                .ok()
                .and_then(|mut c| c.wait().ok())
                .and_then(|s| s.code())
                .unwrap_or(-1);

            if let Ok(mut w) = state_clone.worker.lock() {
                *w = None;
            }

            let current_state = state_clone
                .index_status
                .lock()
                .ok()
                .and_then(|s| {
                    s.get("state")
                        .and_then(|x| x.as_str())
                        .map(|x| x.to_string())
                })
                .unwrap_or_else(|| "idle".to_string());

            if current_state == "paused" {
                return;
            }

            if code == 0 {
                refresh_index_cache(&app_handle, &state_clone);
                let ready = index_status_from_file(&app_handle);
                set_and_emit_status(&app_handle, &state_clone, ready);
            } else {
                let err =
                    json!({"state":"error","lastError":format!("Rust indexer exit code {code}")});
                set_and_emit_status(&app_handle, &state_clone, err);
            }
        });
    }

    start_payload
}

fn pause_indexing_internal(app: &tauri::AppHandle, state: &AppState) -> Value {
    if let Ok(mut lock) = state.worker.lock() {
        if let Some(child_arc) = lock.take() {
            if let Ok(mut child) = child_arc.lock() {
                let _ = child.kill();
            }
        }
    }

    let payload = json!({
      "state": "paused",
      "scanned": 0,
      "total": 0,
      "fileCount": 0,
      "byExt": {},
      "scannedByExt": {}
    });
    set_and_emit_status(app, state, payload.clone());
    payload
}

fn now_stamp() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", ms)
}

fn run_command_capture(command: &str, args: &[&str]) -> (i32, String, String) {
    run_command_capture_timeout(command, args, Duration::from_secs(180))
}

fn run_command_capture_timeout(
    command: &str,
    args: &[&str],
    timeout: Duration,
) -> (i32, String, String) {
    let mut cmd = Command::new(command);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return (-1, "".to_string(), e.to_string()),
    };

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return (
                        124,
                        "".to_string(),
                        format!("command timed out after {}s", timeout.as_secs()),
                    );
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return (-1, "".to_string(), e.to_string()),
        }
    }

    match child.wait_with_output() {
        Ok(out) => {
            let code = out.status.code().unwrap_or(-1);
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            (code, stdout, stderr)
        }
        Err(e) => (-1, "".to_string(), e.to_string()),
    }
}

fn sanitize_process_input(raw: &str) -> String {
    raw.chars()
        .map(|c| if c == '\0' { ' ' } else { c })
        .collect::<String>()
}

fn load_ai_status_internal(app: &tauri::AppHandle, state: &AppState) {
    let settings = load_settings_internal(app);
    let model = if settings.ai_model.trim().is_empty() {
        "qwen2.5:1.5b".to_string()
    } else {
        settings.ai_model.clone()
    };

    let mut payload = json!({
      "installed": false,
      "installing": false,
      "model": model,
      "online": true,
      "provider": "officeghost-cloud",
      "progress": "",
      "error": ""
    });

    if let Some(path) = ai_state_path(app) {
        if path.exists() {
            if let Ok(raw) = fs::read_to_string(path) {
                if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                    if let Some(obj) = v.as_object() {
                        for (k, val) in obj {
                            payload[k] = val.clone();
                        }
                    }
                }
            }
        }
    }

    payload["installing"] = Value::Bool(false);
    payload["model"] = Value::String(settings.ai_model);
    payload["error"] = Value::String("".to_string());

    if let Ok(mut s) = state.ai_status.lock() {
        *s = payload;
    }
}

fn save_ai_status_internal(app: &tauri::AppHandle, state: &AppState) {
    let Some(path) = ai_state_path(app) else {
        return;
    };
    ensure_parent(&path);
    if let Ok(s) = state.ai_status.lock() {
        let _ = fs::write(
            path,
            serde_json::to_string_pretty(&*s).unwrap_or_else(|_| "{}".to_string()),
        );
    }
}

fn emit_ai_status(app: &tauri::AppHandle, state: &AppState) {
    if let Ok(s) = state.ai_status.lock() {
        let _ = app.emit("ai-status", s.clone());
    }
}

fn normalize_token_piece(token: &str) -> String {
    token
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
}

fn stem_token(token: &str) -> String {
    let endings = [
        "иями", "ями", "ами", "его", "ого", "ому", "ему", "ыми", "ими", "иях", "иях", "ией", "ией",
        "ия", "ья", "ий", "ый", "ой", "ая", "ое", "ые", "ов", "ев", "ам", "ям", "ах", "ях", "а",
        "я", "у", "ю", "е", "ы", "и",
    ];

    for end in endings {
        if token.len() > end.len() + 2 && token.ends_with(end) {
            return token[..token.len() - end.len()].to_string();
        }
    }

    token.to_string()
}

fn normalize_search_query(raw: &str) -> String {
    const COMMAND_WORDS: &[&str] = &[
        "найди", "найдите", "найти", "поищи", "поищите", "ищи", "ищите", "ищу",
        "поиск", "покажи", "покажите", "мне", "пожалуйста", "слово", "слова", "фразу",
        "фраза", "в", "во", "на", "по", "из", "с", "со", "файл", "файлы", "файле",
        "файлах", "документ", "документы", "документе", "документах", "find", "search",
        "show", "please", "for", "in", "my", "file", "files", "document", "documents",
    ];

    let meaningful = raw
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .map(normalize_token_piece)
        .filter(|token| token.len() >= 2 && !COMMAND_WORDS.contains(&token.as_str()))
        .collect::<Vec<_>>();

    if meaningful.is_empty() {
        raw.trim().to_lowercase()
    } else {
        meaningful.join(" ")
    }
}

fn tokenize_query(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut seen = std::collections::HashSet::new();

    for part in raw
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|x| !x.trim().is_empty())
    {
        let token = normalize_token_piece(part);
        if token.len() < 2 {
            continue;
        }

        if seen.insert(token.clone()) {
            out.push(token.clone());
        }

        let stem = stem_token(&token);
        if stem.len() >= 3 && seen.insert(stem.clone()) {
            out.push(stem);
        }

        if out.len() >= 20 {
            break;
        }
    }

    out
}

fn char_ngrams(text: &str, n: usize) -> std::collections::HashSet<String> {
    let t = text.to_lowercase();
    let chars: Vec<char> = t.chars().collect();
    if chars.len() < n || n == 0 {
        return std::collections::HashSet::new();
    }
    let mut out = std::collections::HashSet::new();
    for i in 0..=(chars.len() - n) {
        out.insert(chars[i..i + n].iter().collect::<String>());
    }
    out
}

fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let sa = char_ngrams(a, 3);
    let sb = char_ngrams(b, 3);
    if sa.is_empty() || sb.is_empty() {
        return 0.0;
    }
    let inter = sa.intersection(&sb).count() as f64;
    let uni = sa.union(&sb).count() as f64;
    if uni <= 0.0 {
        0.0
    } else {
        inter / uni
    }
}

fn file_fingerprint(path: &str, fallback: &str) -> String {
    let mut hasher = DefaultHasher::new();
    if let Ok(bytes) = fs::read(path) {
        bytes.hash(&mut hasher);
    } else {
        fallback.hash(&mut hasher);
    }
    format!("{:x}", hasher.finish())
}

fn sanitize_folder_name(raw: &str) -> String {
    let cleaned = raw
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return "Разное".to_string();
    }

    cleaned.chars().take(36).collect::<String>()
}

fn category_from_item(item: &Value) -> String {
    let name = get_value_str(item, "name");
    let text = get_value_str(item, "text");
    let ext = get_value_str(item, "ext").to_lowercase();

    let stop: std::collections::HashSet<&str> = [
        "and",
        "the",
        "for",
        "with",
        "this",
        "that",
        "from",
        "file",
        "doc",
        "pdf",
        "xls",
        "xlsx",
        "как",
        "что",
        "для",
        "или",
        "это",
        "файл",
        "документ",
        "отчет",
        "отчёт",
        "данные",
        "информация",
    ]
    .iter()
    .copied()
    .collect();

    let mut pick = String::new();
    for token in name
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|t| t.chars().count() >= 3)
    {
        if !stop.contains(token) {
            pick = token.to_string();
            break;
        }
    }

    if pick.is_empty() {
        for token in text
            .to_lowercase()
            .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            .filter(|t| t.chars().count() >= 4)
            .take(50)
        {
            if !stop.contains(token) {
                pick = token.to_string();
                break;
            }
        }
    }

    if pick.is_empty() {
        pick = match ext.as_str() {
            ".doc" | ".docx" => "Word".to_string(),
            ".xls" | ".xlsx" => "Excel".to_string(),
            ".pdf" => "PDF".to_string(),
            _ => "Разное".to_string(),
        };
    }

    sanitize_folder_name(&pick)
}

fn unique_target_path(target: &Path) -> PathBuf {
    if !target.exists() {
        return target.to_path_buf();
    }

    let parent = target
        .parent()
        .map(|x| x.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = target
        .file_stem()
        .and_then(|x| x.to_str())
        .unwrap_or("file");
    let ext = target.extension().and_then(|x| x.to_str()).unwrap_or("");

    for idx in 1..10000 {
        let name = if ext.is_empty() {
            format!("{} ({})", stem, idx)
        } else {
            format!("{} ({}).{}", stem, idx, ext)
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    target.to_path_buf()
}

fn collect_context_from_index(
    app: &tauri::AppHandle,
    state: &AppState,
    query: &str,
    max_items: usize,
) -> Vec<Value> {
    let q = normalize_search_query(query);
    if q.is_empty() {
        return vec![];
    }

    let tokens = tokenize_query(&q);
    if tokens.is_empty() {
        return vec![];
    }

    let index = load_index_for_queries(app, state);
    let mut scored: Vec<(i64, Value)> = vec![];

    for (_k, item) in index.files {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_lowercase();
        let p = item
            .get("path")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_lowercase();
        let text_raw =
            sanitize_process_input(item.get("text").and_then(|x| x.as_str()).unwrap_or(""));
        let text = text_raw.to_lowercase();

        let mut lexical = 0i64;
        let mut best_text_hit: Option<usize> = None;

        if let Some(i) = text.find(&q) {
            lexical += 30;
            best_text_hit = Some(i);
        }
        if name.contains(&q) {
            lexical += 34;
        }
        if p.contains(&q) {
            lexical += 24;
        }

        for t in &tokens {
            if let Some(i) = text.find(t) {
                lexical += 7;
                best_text_hit = Some(best_text_hit.map(|cur| cur.min(i)).unwrap_or(i));
            }
            if name.contains(t) {
                lexical += 16;
            }
            if p.contains(t) {
                lexical += 10;
            }

            let pref = t.chars().take(4).collect::<String>();
            if pref.chars().count() == 4 {
                if name.contains(&pref) {
                    lexical += 3;
                }
                if text.contains(&pref) {
                    lexical += 2;
                }
            }
        }

        let mut score = lexical as f64;
        if lexical == 0 {
            // Fuzzy rescue for typos/case/morphology: include a bounded text slice too.
            let text_head: String = text.chars().take(1200).collect();
            let sem_target = format!("{} {} {}", name, p, text_head);
            let sem = jaccard_similarity(&q, &sem_target);
            if sem > 0.15 {
                score += sem * 125.0;
            }
        }

        if score <= 0.0 {
            continue;
        }

        let mut snippet = text_raw.replace('\n', " ");
        if let Some(hit) = best_text_hit {
            let start = hit.saturating_sub(160);
            let end = (hit + 320).min(text_raw.len());
            if let Some(slice) = text_raw.get(start..end) {
                snippet = sanitize_process_input(slice).replace('\n', " ");
            }
        }

        if snippet.chars().count() > 260 {
            snippet = snippet.chars().take(260).collect::<String>();
        }

        scored.push((
            score.round() as i64,
            json!({
              "path": item.get("path").cloned().unwrap_or(Value::String("".into())),
              "name": item.get("name").cloned().unwrap_or(Value::String("".into())),
              "snippet": snippet
            }),
        ));
    }

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(max_items).map(|x| x.1).collect()
}

fn is_file_task_query(query: &str) -> bool {
    let q = query.to_lowercase();
    [
        "найд",
        "поиск",
        "собер",
        "документ",
        "файл",
        "из файлов",
        "по файлам",
        "сформируй",
        "создай",
        "отчет",
        "отчёт",
        "информац",
        "данн",
        "фио",
        "ученик",
        "человек",
    ]
    .iter()
    .any(|k| q.contains(k))
}

fn quick_chat_reply(query: &str) -> Option<String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return None;
    }

    if is_file_task_query(&q) {
        return None;
    }

    if [
        "привет",
        "здравств",
        "hello",
        "hi",
        "добрый день",
        "добрый вечер",
    ]
    .iter()
    .any(|k| q.contains(k))
    {
        if q.contains("hello") || q.contains("hi") {
            return Some("Hi. I can help with files: search, summaries, answers from local content, and creating result files on Desktop.".to_string());
        }
        return Some("Привет. Я готов помочь с файлами: поиск, сводка, ответы по содержимому и создание итогового файла на рабочем столе.".to_string());
    }

    if q.contains("спасибо") {
        return Some("Пожалуйста. Можешь сразу написать, что найти в файлах или какой итоговый документ собрать.".to_string());
    }
    if q.contains("thank") {
        return Some(
            "You're welcome. You can ask what to find in files or what final document to generate."
                .to_string(),
        );
    }

    if q.contains("что ты умеешь") || q.contains("что можешь") {
        return Some("Я работаю локально с индексом файлов: нахожу данные по смыслу, делаю краткие сводки и могу подготовить новый файл с результатом.".to_string());
    }
    if q.contains("what can you do") {
        return Some("I work locally with indexed files: semantic search, concise summaries, and creating a new result file.".to_string());
    }

    None
}

fn selected_model_from_settings(app: &tauri::AppHandle) -> String {
    let s = load_settings_internal(app);
    if s.ai_model.trim().is_empty() {
        "qwen2.5:1.5b".to_string()
    } else {
        s.ai_model
    }
}

fn is_model_available(model: &str) -> bool {
    let (code, _, _) = run_command_capture("ollama", &["show", model]);
    code == 0
}

fn resolve_cloud_target(settings: &Settings) -> (String, String) {
    let vendor = settings.cloud_vendor.trim().to_lowercase();
    match vendor.as_str() {
        "openrouter" => (
            "https://openrouter.ai/api/v1/chat/completions".to_string(),
            if settings.cloud_model.trim().is_empty() {
                "openai/gpt-4o-mini".to_string()
            } else {
                settings.cloud_model.trim().to_string()
            },
        ),
        "groq" => (
            "https://api.groq.com/openai/v1/chat/completions".to_string(),
            if settings.cloud_model.trim().is_empty() {
                "llama-3.1-8b-instant".to_string()
            } else {
                settings.cloud_model.trim().to_string()
            },
        ),
        "together" => (
            "https://api.together.xyz/v1/chat/completions".to_string(),
            if settings.cloud_model.trim().is_empty() {
                "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo".to_string()
            } else {
                settings.cloud_model.trim().to_string()
            },
        ),
        "custom" => (
            settings.cloud_api_url.trim().to_string(),
            settings.cloud_model.trim().to_string(),
        ),
        _ => (
            "https://api.openai.com/v1/chat/completions".to_string(),
            if settings.cloud_model.trim().is_empty() {
                "gpt-4o-mini".to_string()
            } else {
                settings.cloud_model.trim().to_string()
            },
        ),
    }
}

fn extract_cloud_answer(parsed: &Value) -> Option<String> {
    let first = parsed.get("choices")?.as_array()?.first()?;

    if let Some(content) = first
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
    {
        let out = content.trim().to_string();
        if !out.is_empty() {
            return Some(out);
        }
    }

    if let Some(content_arr) = first
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    {
        let mut parts: Vec<String> = vec![];
        for chunk in content_arr {
            if let Some(text) = chunk.get("text").and_then(|v| v.as_str()) {
                if !text.trim().is_empty() {
                    parts.push(text.trim().to_string());
                }
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }

    if let Some(text) = first.get("text").and_then(|t| t.as_str()) {
        let out = text.trim().to_string();
        if !out.is_empty() {
            return Some(out);
        }
    }

    None
}

fn call_cloud_ai(settings: &Settings, prompt: &str) -> Result<String, String> {
    let use_officeghost = settings.cloud_vendor.eq_ignore_ascii_case("officeghost")
        || settings.cloud_api_key.trim().is_empty();
    let (url, model) = if use_officeghost {
        ("https://www.officeghost.com/api/chat".to_string(), "officeghost-cloud".to_string())
    } else {
        resolve_cloud_target(settings)
    };
    let payload = if use_officeghost {
        json!({ "prompt": sanitize_process_input(prompt), "history": [] }).to_string()
    } else {
        json!({
          "model": model,
          "temperature": 0.15,
          "messages": [{ "role": "user", "content": sanitize_process_input(prompt) }]
        }).to_string()
    };

    let payload_clean = sanitize_process_input(&payload);
    let vendor = settings.cloud_vendor.trim().to_lowercase();

    let mut args: Vec<&str> = vec![
        "-sS",
        "--max-time",
        "60",
        "-X",
        "POST",
        url.as_str(),
        "-H",
        "Content-Type: application/json",
    ];
    let auth = format!("Authorization: Bearer {}", settings.cloud_api_key.trim());
    if !use_officeghost {
        args.push("-H");
        args.push(auth.as_str());
    } else {
        args.push("-H");
        args.push("X-OfficeGhost-Client: desktop");
    }
    if vendor == "openrouter" {
        args.push("-H");
        args.push("HTTP-Referer: https://officeghost.com");
        args.push("-H");
        args.push("X-Title: OfficeGhost");
    }
    args.push("-d");
    args.push(payload_clean.as_str());

    let (code, stdout, stderr) = run_command_capture("curl", &args);

    if code != 0 {
        let msg = if !stderr.trim().is_empty() {
            stderr
        } else {
            stdout
        };
        return Err(if msg.trim().is_empty() {
            "Ошибка облачного ИИ".to_string()
        } else {
            msg.trim().to_string()
        });
    }

    let parsed: Value = serde_json::from_str(&stdout).map_err(|_| {
        let short = stdout.chars().take(400).collect::<String>();
        format!("Невалидный ответ облачного ИИ: {}", short)
    })?;

    let answer = if use_officeghost {
        parsed.get("answer").and_then(|value| value.as_str()).unwrap_or("").trim().to_string()
    } else {
        extract_cloud_answer(&parsed).unwrap_or_default()
    };

    if answer.is_empty() {
        return Err("Пустой ответ модели".to_string());
    }

    Ok(answer)
}

fn detect_create_file_intent(query: &str) -> Option<String> {
    let q = query.to_lowercase();
    let wants = q.contains("создай")
        || q.contains("создать")
        || q.contains("сформиру")
        || q.contains("сделай")
        || q.contains("создай файл")
        || q.contains("создай документ")
        || q.contains("make")
        || q.contains("create")
        || q.contains("generate")
        || q.contains("save")
        || q.contains("сохрани");
    if !wants {
        return None;
    }

    if q.contains("md") || q.contains("markdown") {
        return Some("md".to_string());
    }
    if q.contains("txt") || q.contains("текст") || q.contains("text") {
        return Some("txt".to_string());
    }
    if q.contains("excel")
        || q.contains("xlsx")
        || q.contains("xls")
        || q.contains("таблиц")
        || q.contains("эксел")
        || q.contains("ексель")
    {
        return Some("xlsx".to_string());
    }
    if q.contains("pdf") || q.contains("пдф") {
        return Some("pdf".to_string());
    }
    if q.contains("word")
        || q.contains("docx")
        || q.contains("doc")
        || q.contains("ворд")
        || q.contains("документ")
    {
        return Some("docx".to_string());
    }
    Some("docx".to_string())
}

fn should_create_empty_file(query: &str) -> bool {
    let q = query.to_lowercase().replace('ё', "е");
    if q.contains("пуст") || q.contains("blank") || q.contains("empty") {
        return true;
    }

    let create_intent = q.contains("создай")
        || q.contains("создать")
        || q.contains("сформиру")
        || q.contains("сделай")
        || q.contains("make")
        || q.contains("create")
        || q.contains("generate")
        || q.contains("сохрани");

    if !create_intent {
        return false;
    }

    let has_content_intent = q.contains("по файлам")
        || q.contains("на основе")
        || q.contains("сводк")
        || q.contains("собери")
        || q.contains("содержим")
        || q.contains("заполни")
        || q.contains("информац")
        || q.contains("данн")
        || q.contains("итог")
        || q.contains("summary")
        || q.contains("report")
        || q.contains("о ")
        || q.contains("об ")
        || q.contains("про ")
        || q.contains("на тему");

    if has_content_intent {
        return false;
    }

    let stop: std::collections::HashSet<&str> = [
        "создай",
        "создать",
        "сформируй",
        "сформировать",
        "сделай",
        "файл",
        "документ",
        "док",
        "документ",
        "ворд",
        "word",
        "doc",
        "docx",
        "excel",
        "xlsx",
        "xls",
        "таблицу",
        "таблица",
        "pdf",
        "пдф",
        "txt",
        "text",
        "текст",
        "markdown",
        "md",
        "пожалуйста",
        "плиз",
        "мне",
        "нужен",
        "нужна",
        "нужно",
        "и",
        "в",
        "на",
        "для",
        "please",
        "make",
        "create",
        "generate",
        "save",
        "сохрани",
    ]
    .iter()
    .copied()
    .collect();

    let meaningful: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
        .map(|x| x.to_string())
        .filter(|x| !stop.contains(x.as_str()))
        .collect();

    meaningful.is_empty()
}

fn create_file_on_desktop(ext: &str, content: &str) -> Result<PathBuf, String> {
    let desktop = if cfg!(target_os = "windows") {
        std::env::var("USERPROFILE")
            .map(|p| PathBuf::from(p).join("Desktop"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("HOME")
            .map(|p| PathBuf::from(p).join("Desktop"))
            .unwrap_or_else(|_| PathBuf::from("."))
    };

    let file_name = format!("OfficeGhost_{}.{}", now_stamp(), ext);
    let out = desktop.join(file_name);
    match ext {
        "docx" => write_docx(&out, content)?,
        "xlsx" => write_xlsx(&out, content)?,
        _ => fs::write(&out, content).map_err(|e| e.to_string())?,
    }
    Ok(out)
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn write_zip_entry(
    zip: &mut zip::ZipWriter<fs::File>,
    name: &str,
    content: &str,
) -> Result<(), String> {
    zip.start_file(name, zip::write::FileOptions::default())
        .map_err(|e| e.to_string())?;
    zip.write_all(content.as_bytes()).map_err(|e| e.to_string())
}

fn write_docx(path: &Path, content: &str) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    write_zip_entry(
        &mut zip,
        "[Content_Types].xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#,
    )?;
    let paragraphs = content
        .lines()
        .map(|line| {
            format!(
                r#"<w:p><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
                xml_escape(line)
            )
        })
        .collect::<Vec<_>>()
        .join("");
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{}<w:sectPr/></w:body></w:document>"#,
        paragraphs
    );
    write_zip_entry(&mut zip, "word/document.xml", &document)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn write_xlsx(path: &Path, content: &str) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    write_zip_entry(
        &mut zip,
        "[Content_Types].xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "xl/workbook.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OfficeGhost" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
    )?;
    write_zip_entry(
        &mut zip,
        "xl/_rels/workbook.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
    )?;
    let rows = content.lines().enumerate().map(|(index, line)| format!(r#"<row r="{row}"><c r="A{row}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c></row>"#, row = index + 1, text = xml_escape(line))).collect::<Vec<_>>().join("");
    let sheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{}</sheetData></worksheet>"#,
        rows
    );
    write_zip_entry(&mut zip, "xl/worksheets/sheet1.xml", &sheet)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_user_file_context(app: &tauri::AppHandle, file_path: &str) -> Value {
    let p = PathBuf::from(file_path);
    if !p.exists() {
        return json!({"path": file_path, "content": "[File not found]"});
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "txt" || ext == "md" {
        if let Ok(raw) = fs::read_to_string(&p) {
            let part = sanitize_process_input(&raw)
                .chars()
                .take(1200)
                .collect::<String>();
            return json!({"path": file_path, "content": part});
        }
    }

    if let Some(indexer) = find_rust_indexer_path(app) {
        let indexer_string = indexer.to_string_lossy().to_string();
        let (code, stdout, _) = run_command_capture_timeout(
            &indexer_string,
            &["extract", "--file", file_path],
            Duration::from_secs(30),
        );
        if code == 0 {
            if let Ok(value) = serde_json::from_str::<Value>(stdout.trim()) {
                return value;
            }
        }
    }

    json!({"path": file_path, "content": "[Content not extracted, file path is available]"})
}

fn get_value_str<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

fn set_and_emit_update_status(app: &tauri::AppHandle, state: &AppState, payload: Value) -> Value {
    if let Ok(mut lock) = state.app_update_status.lock() {
        *lock = payload.clone();
    }
    let _ = app.emit("app-update-status", payload.clone());
    payload
}

#[tauri::command]
fn get_app_update_status(state: State<'_, AppState>) -> Value {
    state
        .app_update_status
        .lock()
        .map(|x| x.clone())
        .unwrap_or_else(|_| {
            json!({
              "state": "idle",
              "available": false,
              "version": "",
              "downloading": false,
              "installed": false,
              "progress": 0,
              "error": ""
            })
        })
}

async fn check_app_update_internal(
    app: &tauri::AppHandle,
    state: &AppState,
    manual: bool,
) -> Value {
    let st = load_settings_internal(app);
    let is_ru = st.language.eq_ignore_ascii_case("ru");

    let _ = set_and_emit_update_status(
        app,
        state,
        json!({
          "state": "checking",
          "available": false,
          "version": "",
          "downloading": false,
          "installed": false,
          "progress": 0,
          "error": ""
        }),
    );

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            let err = if is_ru {
                format!("Модуль обновлений не подключен: {}", e)
            } else {
                format!("Updater module is not configured: {}", e)
            };
            if !manual {
                return set_and_emit_update_status(
                    app,
                    state,
                    json!({
                      "state": "idle",
                      "available": false,
                      "version": "",
                      "downloading": false,
                      "installed": false,
                      "error": "",
                      "manual": false
                    }),
                );
            }
            return set_and_emit_update_status(
                app,
                state,
                json!({
                  "state": "error",
                  "available": false,
                  "version": "",
                  "downloading": false,
                  "installed": false,
                  "error": err,
                  "manual": manual
                }),
            );
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.to_string();
            set_and_emit_update_status(
                app,
                state,
                json!({
                  "state": "available",
                  "available": true,
                  "version": version,
                  "downloading": false,
                  "installed": false,
                  "progress": 0,
                  "error": "",
                  "manual": manual
                }),
            )
        }
        Ok(None) => set_and_emit_update_status(
            app,
            state,
            json!({
              "state": "up-to-date",
              "available": false,
              "version": "",
              "downloading": false,
              "installed": false,
              "error": "",
              "manual": manual
            }),
        ),
        Err(e) => {
            let err = if is_ru {
                format!("Не удалось проверить обновления: {}", e)
            } else {
                format!("Failed to check updates: {}", e)
            };
            if !manual {
                return set_and_emit_update_status(
                    app,
                    state,
                    json!({
                      "state": "idle",
                      "available": false,
                      "version": "",
                      "downloading": false,
                      "installed": false,
                      "error": "",
                      "manual": false
                    }),
                );
            }
            set_and_emit_update_status(
                app,
                state,
                json!({
                  "state": "error",
                  "available": false,
                  "version": "",
                  "downloading": false,
                  "installed": false,
                  "error": err,
                  "manual": manual
                }),
            )
        }
    }
}

#[tauri::command]
async fn check_app_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    manual: Option<bool>,
) -> Result<Value, String> {
    let app_state = state.inner().clone();
    Ok(check_app_update_internal(&app, &app_state, manual.unwrap_or(false)).await)
}

#[tauri::command]
async fn install_app_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let app_state = state.inner().clone();
    let st = load_settings_internal(&app);
    let is_ru = st.language.eq_ignore_ascii_case("ru");

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            let err = if is_ru {
                format!("Модуль обновлений не подключен: {}", e)
            } else {
                format!("Updater module is not configured: {}", e)
            };
            return Ok(set_and_emit_update_status(
                &app,
                &app_state,
                json!({
                  "state": "error",
                  "available": false,
                  "version": "",
                  "downloading": false,
                  "installed": false,
                  "error": err
                }),
            ));
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return Ok(set_and_emit_update_status(
                &app,
                &app_state,
                json!({
                  "state": "up-to-date",
                  "available": false,
                  "version": "",
                  "downloading": false,
                  "installed": false,
                  "error": ""
                }),
            ));
        }
        Err(e) => {
            let err = if is_ru {
                format!("Не удалось проверить обновления: {}", e)
            } else {
                format!("Failed to check updates: {}", e)
            };
            return Ok(set_and_emit_update_status(
                &app,
                &app_state,
                json!({
                  "state": "error",
                  "available": false,
                  "version": "",
                  "downloading": false,
                  "installed": false,
                  "error": err
                }),
            ));
        }
    };

    let version = update.version.to_string();
    let _ = set_and_emit_update_status(
        &app,
        &app_state,
        json!({
          "state": "downloading",
          "available": true,
          "version": version,
          "downloading": true,
          "installed": false,
          "progress": 0,
          "error": ""
        }),
    );

    let progress_app = app.clone();
    let progress_state = app_state.clone();
    let progress_version = version.clone();
    let mut downloaded = 0u64;
    let mut last_progress = 0u64;
    let out = update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                let progress = content_len
                    .filter(|total| *total > 0)
                    .map(|total| (downloaded.saturating_mul(100) / total).min(99))
                    .unwrap_or(0);
                if progress == 0 || progress >= last_progress.saturating_add(2) {
                    last_progress = progress;
                    let _ = set_and_emit_update_status(
                        &progress_app,
                        &progress_state,
                        json!({
                          "state": "downloading",
                          "available": true,
                          "version": progress_version,
                          "downloading": true,
                          "installed": false,
                          "progress": progress,
                          "error": ""
                        }),
                    );
                }
            },
            || {},
        )
        .await;

    match out {
        Ok(_) => {
            let _ = set_and_emit_update_status(
                &app,
                &app_state,
                json!({
                  "state": "installed",
                  "available": false,
                    "version": "",
                    "downloading": false,
                    "installed": true,
                    "progress": 100,
                    "error": ""
                }),
            );
            app.restart()
        }
        Err(e) => {
            let err = if is_ru {
                format!("Ошибка установки обновления: {}", e)
            } else {
                format!("Update install failed: {}", e)
            };
            Ok(set_and_emit_update_status(
                &app,
                &app_state,
                json!({
                  "state": "error",
                  "available": true,
                  "version": version,
                  "downloading": false,
                  "installed": false,
                  "error": err
                }),
            ))
        }
    }
}

fn normalize_hotkey_value(value: &str) -> String {
    let mut v = value.trim().to_string();
    v = v.replace("CommandOrControl", "CmdOrCtrl");
    v = v.replace("Control", "Ctrl");
    v = v.replace("Command", "Cmd");
    v = v.replace("Meta", "Cmd");
    for d in 0..=9 {
        v = v.replace(&format!("num{}", d), &format!("Numpad{}", d));
        v = v.replace(&format!("Num{}", d), &format!("Numpad{}", d));
    }
    v
}

fn apply_saved_main_position(app: &tauri::AppHandle) {
    let st = load_settings_internal(app);
    if !st.remember_pos {
        return;
    }
    let Some(pos) = st.window_pos else {
        return;
    };
    let x = pos.get("x").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let y = pos.get("y").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )));
        ensure_main_window_in_screen(app);
    }
}

fn ensure_main_window_in_screen(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let Ok(pos) = w.outer_position() else {
            return;
        };
        let Ok(size) = w.outer_size() else {
            return;
        };
        let Ok(Some(mon)) = w.current_monitor() else {
            return;
        };

        let mpos = mon.position();
        let msize = mon.size();

        let min_x = mpos.x;
        let min_y = mpos.y;
        let max_x = mpos.x + (msize.width as i32 - size.width as i32).max(0);
        let max_y = mpos.y + (msize.height as i32 - size.height as i32).max(0);

        let nx = pos.x.clamp(min_x, max_x);
        let ny = pos.y.clamp(min_y, max_y);

        if nx != pos.x || ny != pos.y {
            let _ = w.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
                nx, ny,
            )));
        }
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        if visible {
            if let Some(sw) = app.get_webview_window("settings") {
                let _ = sw.close();
            }
            let _ = w.hide();
            return;
        }

        let _ = w.show();
        let _ = w.set_focus();
        ensure_main_window_in_screen(app);
        let _ = app.emit("focus-input", json!({}));
    }
}

fn setup_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let label_open = if is_ru(app) {
        "Показать/Скрыть"
    } else {
        "Show/Hide"
    };
    let label_quit = if is_ru(app) { "Выйти" } else { "Quit" };

    let open_item = MenuItemBuilder::with_id("tray_open", label_open)
        .build(app)
        .map_err(|e| format!("tray menu open item: {e}"))?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", label_quit)
        .build(app)
        .map_err(|e| format!("tray menu quit item: {e}"))?;
    let menu = MenuBuilder::new(app)
        .items(&[&open_item, &quit_item])
        .build()
        .map_err(|e| format!("tray menu build: {e}"))?;

    let icon = app.default_window_icon().cloned();
    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "tray_open" => toggle_main_window(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == tauri::tray::MouseButton::Left
                    && button_state == tauri::tray::MouseButtonState::Up
                {
                    toggle_main_window(tray.app_handle());
                }
            }
        });

    if let Some(ic) = icon {
        tray_builder = tray_builder.icon(ic);
    }

    tray_builder
        .build(app)
        .map_err(|e| format!("tray build: {e}"))?;

    Ok(())
}

fn apply_hotkey(app: &tauri::AppHandle, hotkey: &str) -> Result<(), String> {
    let hk = normalize_hotkey_value(hotkey);
    let manager = app.global_shortcut();
    manager
        .unregister_all()
        .map_err(|e| format!("unregister_all failed: {e}"))?;
    if hk.trim().is_empty() {
        return Ok(());
    }
    manager
        .register(hk.as_str())
        .map_err(|e| format!("register hotkey failed: {e}"))?;
    Ok(())
}

fn complete_desktop_auth(app: tauri::AppHandle, code: String, state: String) {
    let payload = json!({ "code": code, "state": state }).to_string();
    let (exit_code, stdout, stderr) = run_command_capture_timeout(
        "curl",
        &[
            "-sS",
            "--max-time",
            "30",
            "-X",
            "POST",
            "https://www.officeghost.com/api/desktop-auth/session",
            "-H",
            "Content-Type: application/json",
            "-d",
            payload.as_str(),
        ],
        Duration::from_secs(35),
    );

    let mut auth = load_desktop_auth_internal(&app);
    auth.pending_state.clear();
    if exit_code != 0 {
        auth.error = if stderr.trim().is_empty() { "Не удалось связаться с OfficeGhost".to_string() } else { stderr.trim().to_string() };
    } else if let Ok(response) = serde_json::from_str::<Value>(&stdout) {
        if let (Some(token), Some(profile)) = (response.get("token").and_then(|value| value.as_str()), response.get("profile")) {
            auth.token = token.to_string();
            auth.profile = Some(profile.clone());
            auth.error.clear();
        } else {
            auth.error = response.get("error").and_then(|value| value.as_str()).unwrap_or("Не удалось завершить вход").to_string();
        }
    } else {
        auth.error = "Сайт OfficeGhost вернул некорректный ответ".to_string();
    }
    save_desktop_auth_internal(&app, &auth);
    emit_desktop_auth(&app, &auth);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_desktop_auth_url(app: &tauri::AppHandle, raw_url: &str) {
    let Ok(url) = Url::parse(raw_url) else { return; };
    if url.scheme() != "officeghost" || url.host_str() != Some("auth") || url.path() != "/callback" {
        return;
    }
    let values = url.query_pairs().collect::<HashMap<_, _>>();
    let code = values.get("code").map(|value| value.to_string()).unwrap_or_default();
    let state = values.get("state").map(|value| value.to_string()).unwrap_or_default();
    let pending = load_desktop_auth_internal(app).pending_state;
    if code.len() < 32 || state.is_empty() || state != pending {
        return;
    }
    let handle = app.clone();
    thread::spawn(move || complete_desktop_auth(handle, code, state));
}

#[tauri::command]
fn get_desktop_auth(app: tauri::AppHandle) -> Value {
    desktop_auth_status(&load_desktop_auth_internal(&app))
}

#[tauri::command]
fn begin_desktop_auth(app: tauri::AppHandle) -> Value {
    let state = rand::thread_rng().sample_iter(&Alphanumeric).take(48).map(char::from).collect::<String>();
    let mut auth = load_desktop_auth_internal(&app);
    auth.pending_state = state.clone();
    auth.error.clear();
    save_desktop_auth_internal(&app, &auth);
    emit_desktop_auth(&app, &auth);
    open_target(&format!("https://www.officeghost.com/desktop-auth?state={state}"));
    desktop_auth_status(&auth)
}

#[tauri::command]
fn sign_out_desktop(app: tauri::AppHandle) -> Value {
    let auth = load_desktop_auth_internal(&app);
    if !auth.token.is_empty() {
        let authorization = format!("Authorization: Bearer {}", auth.token);
        let _ = run_command_capture_timeout(
            "curl",
            &[
                "-sS",
                "--max-time",
                "15",
                "-X",
                "DELETE",
                "https://www.officeghost.com/api/desktop-auth/session",
                "-H",
                authorization.as_str(),
            ],
            Duration::from_secs(20),
        );
    }
    let next = DesktopAuthData::default();
    save_desktop_auth_internal(&app, &next);
    emit_desktop_auth(&app, &next);
    desktop_auth_status(&next)
}

#[tauri::command]
fn open_path(file_path: String) {
    open_target(&file_path);
}

#[tauri::command]
fn open_in_folder(file_path: String) -> bool {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .args(["-R", &file_path])
            .spawn();
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", file_path))
            .spawn();
        return true;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = Path::new(&file_path).parent() {
            open_target(parent.to_string_lossy().as_ref());
            return true;
        }
        false
    }
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(sw) = app.get_webview_window("settings") {
        let _ = sw.close();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn begin_drag(app: tauri::AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.start_dragging();
        return true;
    }
    false
}

#[tauri::command]
fn set_window_height(app: tauri::AppHandle, height: i64) {
    if let Some(w) = app.get_webview_window("main") {
        if let (Ok(size), Ok(scale)) = (w.inner_size(), w.scale_factor()) {
            let width_logical = (size.width as f64) / scale;
            let current_h = (size.height as f64) / scale;
            let target_h = height.clamp(200, 760) as f64;
            // Respect manual resize: auto-resizer can grow window for content, but doesn't force-shrink it.
            if target_h > current_h + 1.0 {
                let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                    width_logical,
                    target_h,
                )));
                ensure_main_window_in_screen(&app);
            }
        }
    }
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> bool {
    let title = if is_ru(&app) {
        "Настройки"
    } else {
        "Settings"
    };
    if app.get_webview_window("settings").is_some() {
        if let Some(w) = app.get_webview_window("settings") {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return true;
    }

    let mut builder =
        WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()));
    builder = builder
        .title(title)
        .inner_size(490.0, 410.0)
        .resizable(true)
        .always_on_top(true)
        .decorations(false);

    let _ = builder.build();
    true
}

#[tauri::command]
fn close_settings(app: tauri::AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.close();
    }
    true
}

fn place_sort_window_below_main(app: &tauri::AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Some(sort) = app.get_webview_window("sort") else {
        return;
    };

    let Ok(main_pos) = main.outer_position() else {
        return;
    };
    let Ok(main_size) = main.outer_size() else {
        return;
    };
    let Ok(sort_size) = sort.outer_size() else {
        return;
    };

    let mut x = main_pos.x + ((main_size.width as i32 - sort_size.width as i32) / 2);
    let mut y = main_pos.y + main_size.height as i32 + 8;

    if let Ok(Some(mon)) = main.current_monitor() {
        let mpos = mon.position();
        let msize = mon.size();
        let max_x = mpos.x + (msize.width as i32 - sort_size.width as i32).max(0);
        let max_y = mpos.y + (msize.height as i32 - sort_size.height as i32).max(0);
        x = x.clamp(mpos.x, max_x);
        y = y.clamp(mpos.y, max_y);
    }

    let _ = sort.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        x, y,
    )));
}

#[tauri::command]
fn open_sort_window(app: tauri::AppHandle) -> bool {
    let title = if is_ru(&app) {
        "Сортировка"
    } else {
        "Sorting"
    };
    if app.get_webview_window("sort").is_some() {
        if let Some(w) = app.get_webview_window("sort") {
            let _ = w.show();
            place_sort_window_below_main(&app);
            let _ = w.set_focus();
        }
        return true;
    }

    let _ = WebviewWindowBuilder::new(&app, "sort", WebviewUrl::App("sort.html".into()))
        .title(title)
        .inner_size(820.0, 380.0)
        .resizable(true)
        .always_on_top(true)
        .decorations(false)
        .build();

    place_sort_window_below_main(&app);
    let _ = app.emit("sort-opened", json!({}));
    true
}

#[tauri::command]
fn close_sort_window(app: tauri::AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("sort") {
        let _ = w.close();
    }
    true
}

#[tauri::command]
fn begin_drag_sort(app: tauri::AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("sort") {
        let _ = w.start_dragging();
        return true;
    }
    false
}

#[tauri::command]
fn resize_sort_window(app: tauri::AppHandle, width: i64, height: i64) -> bool {
    if let Some(w) = app.get_webview_window("sort") {
        let ww = width.clamp(780, 1500) as f64;
        let hh = height.clamp(340, 1100) as f64;
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(ww, hh)));
        return true;
    }
    false
}

#[tauri::command]
fn get_report_path(app: tauri::AppHandle) -> String {
    report_path(&app)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn open_report(app: tauri::AppHandle) {
    if let Some(rp) = report_path(&app) {
        open_target(rp.to_string_lossy().as_ref());
    }
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    load_settings_internal(&app)
}

#[tauri::command]
fn choose_index_folder(app: tauri::AppHandle) -> Settings {
    let mut settings = load_settings_internal(&app);
    if let Some(folder) = rfd::FileDialog::new().pick_folder() {
        let value = folder.to_string_lossy().to_string();
        if !settings.roots.contains(&value) {
            settings.roots.push(value);
            save_settings_internal(&app, &settings);
            let _ = app.emit(
                "settings-updated",
                serde_json::to_value(&settings).unwrap_or_else(|_| json!({})),
            );
        }
    }
    settings
}

#[tauri::command]
fn choose_chat_files() -> Vec<String> {
    rfd::FileDialog::new()
        .add_filter(
            "Documents",
            &[
                "pdf", "docx", "xlsx", "pptx", "txt", "md", "csv", "json", "html", "htm", "rtf",
            ],
        )
        .pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn update_settings(app: tauri::AppHandle, partial: Value) -> Settings {
    let mut current = load_settings_internal(&app);

    if let Some(v) = partial.get("paused").and_then(|v| v.as_bool()) {
        current.paused = v;
    }
    if let Some(v) = partial.get("roots").and_then(|v| v.as_array()) {
        current.roots = v
            .iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .filter(|x| Path::new(x).exists())
            .collect();
    }
    if let Some(v) = partial.get("hotkey").and_then(|v| v.as_str()) {
        current.hotkey = v.to_string();
    }
    if let Some(v) = partial.get("rememberQuery").and_then(|v| v.as_bool()) {
        current.remember_query = v;
    }
    if let Some(v) = partial.get("rememberPos").and_then(|v| v.as_bool()) {
        current.remember_pos = v;
    }
    if let Some(v) = partial.get("opacity").and_then(|v| v.as_f64()) {
        current.opacity = v;
    }
    if let Some(v) = partial.get("indexIntervalSec").and_then(|v| v.as_i64()) {
        current.index_interval_sec = v;
    }
    if let Some(v) = partial.get("maxFileSizeMb").and_then(|v| v.as_i64()) {
        current.max_file_size_mb = v;
    }
    if let Some(v) = partial.get("unlimitedIndexing").and_then(|v| v.as_bool()) {
        current.unlimited_indexing = v;
    }
    if let Some(v) = partial.get("scheduleEnabled").and_then(|v| v.as_bool()) {
        current.schedule_enabled = v;
    }
    if let Some(v) = partial.get("scheduleMinutes").and_then(|v| v.as_i64()) {
        current.schedule_minutes = v.max(1);
    }
    if let Some(v) = partial.get("aiModel").and_then(|v| v.as_str()) {
        current.ai_model = v.to_string();
    }
    if let Some(v) = partial.get("language").and_then(|v| v.as_str()) {
        current.language = if v.eq_ignore_ascii_case("ru") {
            "ru".to_string()
        } else {
            "en".to_string()
        };
    }
    current.ai_provider = "auto".to_string();
    current.cloud_vendor = "officeghost".to_string();
    current.cloud_api_url = "https://www.officeghost.com/api/chat".to_string();
    if let Some(v) = partial.get("licenseEmail").and_then(|v| v.as_str()) {
        current.license_email = v.to_string();
    }
    if let Some(v) = partial.get("licenseKey").and_then(|v| v.as_str()) {
        current.license_key = v.to_string();
    }
    if let Some(v) = partial.get("licenseStatus").and_then(|v| v.as_str()) {
        current.license_status = v.to_string();
    }
    if let Some(v) = partial.get("windowPos") {
        if v.is_null() {
            current.window_pos = None;
        } else {
            current.window_pos = Some(v.clone());
        }
    }

    if partial.get("hotkey").is_some() {
        let _ = apply_hotkey(&app, &current.hotkey);
    }

    if partial.get("aiModel").is_some() {
        if let Some(st) = app.try_state::<AppState>() {
            if let Ok(mut ai) = st.ai_status.lock() {
                ai["model"] = Value::String(current.ai_model.clone());
            }
            save_ai_status_internal(&app, st.inner());
            emit_ai_status(&app, st.inner());
        }
    }

    if partial.get("scheduleEnabled").is_some() || partial.get("scheduleMinutes").is_some() {
        if let Some(st) = app.try_state::<AppState>() {
            if let Ok(mut last) = st.last_schedule_run.lock() {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                if current.schedule_enabled {
                    *last = now.saturating_sub((current.schedule_minutes.max(1) * 60) - 5);
                } else {
                    *last = now;
                }
            }
        }
    }

    save_settings_internal(&app, &current);
    let _ = app.emit(
        "settings-updated",
        serde_json::to_value(&current).unwrap_or_else(|_| json!({})),
    );
    current
}

#[tauri::command]
fn get_index_status(state: State<'_, AppState>) -> Value {
    state
        .index_status
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| json!({"state":"idle","scanned":0,"total":0,"fileCount":0}))
}

#[tauri::command]
fn search(app: tauri::AppHandle, state: State<'_, AppState>, query: String) -> Vec<Value> {
    let q = normalize_search_query(&query);
    let tokens = tokenize_query(&q);

    let index = load_index_for_queries(&app, state.inner());
    let mut out: Vec<(i64, Value)> = vec![];

    for (_k, v) in index.files {
        let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("");
        let path = v.get("path").and_then(|x| x.as_str()).unwrap_or("");
        let text = v.get("text").and_then(|x| x.as_str()).unwrap_or("");

        let nl = name.to_lowercase();
        let pl = path.to_lowercase();
        let tl = text.to_lowercase();

        let mut score = 0;
        if q.is_empty() {
            score = 1;
        }
        if nl.contains(&q) {
            score += 3;
        }
        if pl.contains(&q) {
            score += 2;
        }
        if tl.contains(&q) {
            score += 1;
        }
        for token in &tokens {
            if nl.contains(token) {
                score += 8;
            }
            if pl.contains(token) {
                score += 3;
            }
            if tl.contains(token) {
                score += 2;
            }
        }
        if score == 0 {
            continue;
        }

        let hit = tl.find(&q).or_else(|| tokens.iter().filter(|token| token.len() > 1).filter_map(|token| tl.find(token)).min());
        let snippet = if tl.is_empty() {
            "".to_string()
        } else if let Some(i) = hit {
            let hit_len = if tl.get(i..).map(|tail| tail.starts_with(&q)).unwrap_or(false) { q.len() } else { tokens.iter().find(|token| tl.get(i..).map(|tail| tail.starts_with(token.as_str())).unwrap_or(false)).map(|token| token.len()).unwrap_or(1) };
            let mut start = i.saturating_sub(80);
            let mut end = (i + hit_len + 140).min(text.len());
            while start > 0 && !text.is_char_boundary(start) {
                start -= 1;
            }
            while end > start && !text.is_char_boundary(end) {
                end -= 1;
            }
            let mut out = text
                .get(start..end)
                .unwrap_or("")
                .replace('\n', " ")
                .replace('\r', " ");
            if out.chars().count() > 200 {
                out = out.chars().take(200).collect::<String>();
            }
            out
        } else {
            text.chars()
                .take(160)
                .collect::<String>()
                .replace('\n', " ")
                .replace('\r', " ")
        };

        out.push((
            score,
            json!({
              "title": if name.is_empty() { path } else { name },
              "path": path,
              "snippet": snippet,
              "score": score
            }),
        ));
    }

    out.sort_by(|a, b| {
        b.0.cmp(&a.0).then_with(|| {
            let an = a.1.get("title").and_then(|x| x.as_str()).unwrap_or("");
            let bn = b.1.get("title").and_then(|x| x.as_str()).unwrap_or("");
            an.to_lowercase().cmp(&bn.to_lowercase())
        })
    });
    out.into_iter().take(50).map(|x| x.1).collect()
}

#[tauri::command]
fn get_ai_status(state: State<'_, AppState>) -> Value {
    state
        .ai_status
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| {
            json!({
              "installed": false,
              "installing": false,
              "model": "qwen2.5:1.5b",
              "progress": "",
              "error": ""
            })
        })
}

#[tauri::command]
fn install_ai(app: tauri::AppHandle, state: State<'_, AppState>) -> Value {
    let model = selected_model_from_settings(&app);
    let lang = load_settings_internal(&app).language;
    let is_ru = lang.eq_ignore_ascii_case("ru");
    let txt_preparing = if is_ru {
        "Подготовка установки..."
    } else {
        "Preparing installation..."
    };
    let txt_no_ollama = if is_ru {
        "Ollama не найдена. Установи Ollama и повтори."
    } else {
        "Ollama was not found. Install Ollama and try again."
    };
    let txt_loading = if is_ru {
        "Загрузка модели..."
    } else {
        "Downloading model..."
    };
    let txt_installed = if is_ru {
        "ИИ установлен"
    } else {
        "AI installed"
    };
    let txt_install_error = if is_ru {
        "Ошибка установки ИИ"
    } else {
        "AI installation error"
    };

    {
        if let Ok(mut s) = state.ai_status.lock() {
            let installing = s
                .get("installing")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            if installing {
                return s.clone();
            }
            s["model"] = Value::String(model.clone());
            s["installing"] = Value::Bool(true);
            s["progress"] = Value::String(txt_preparing.to_string());
            s["error"] = Value::String("".to_string());
            let _ = app.emit("ai-status", s.clone());
        }
    }

    let (ver_code, _out, _err) = run_command_capture("ollama", &["--version"]);
    if ver_code != 0 {
        if let Ok(mut s) = state.ai_status.lock() {
            s["installing"] = Value::Bool(false);
            s["installed"] = Value::Bool(false);
            s["error"] = Value::String(txt_no_ollama.to_string());
            let _ = app.emit("ai-status", s.clone());
        }
        save_ai_status_internal(&app, state.inner());
        return get_ai_status(state);
    }

    if let Ok(mut s) = state.ai_status.lock() {
        s["progress"] = Value::String(txt_loading.to_string());
        let _ = app.emit("ai-progress", json!({"message": txt_loading}));
        let _ = app.emit("ai-status", s.clone());
    }

    let (code, stdout, stderr) = run_command_capture("ollama", &["pull", &model]);
    if code == 0 {
        if let Ok(mut s) = state.ai_status.lock() {
            s["installing"] = Value::Bool(false);
            s["installed"] = Value::Bool(true);
            s["progress"] = Value::String(txt_installed.to_string());
            s["error"] = Value::String("".to_string());
            let _ = app.emit("ai-progress", json!({"message": txt_installed}));
            let _ = app.emit("ai-status", s.clone());
        }
    } else {
        let msg = if !stderr.trim().is_empty() {
            stderr
        } else {
            stdout
        };
        if let Ok(mut s) = state.ai_status.lock() {
            s["installing"] = Value::Bool(false);
            s["installed"] = Value::Bool(false);
            s["error"] = Value::String(if msg.trim().is_empty() {
                txt_install_error.to_string()
            } else {
                msg.trim().to_string()
            });
            let _ = app.emit("ai-status", s.clone());
        }
    }

    save_ai_status_internal(&app, state.inner());
    get_ai_status(state)
}

#[tauri::command]
fn remove_ai(app: tauri::AppHandle, state: State<'_, AppState>) -> Value {
    let model = selected_model_from_settings(&app);
    let lang = load_settings_internal(&app).language;
    let is_ru = lang.eq_ignore_ascii_case("ru");
    let txt_remove_error = if is_ru {
        "Не удалось удалить модель"
    } else {
        "Failed to remove model"
    };
    let (code, stdout, stderr) = run_command_capture("ollama", &["rm", &model]);

    if code != 0 && code != -1 {
        if let Ok(mut s) = state.ai_status.lock() {
            let msg = if !stderr.trim().is_empty() {
                stderr
            } else {
                stdout
            };
            s["error"] = Value::String(if msg.trim().is_empty() {
                txt_remove_error.to_string()
            } else {
                msg.trim().to_string()
            });
            let _ = app.emit("ai-status", s.clone());
        }
        save_ai_status_internal(&app, state.inner());
        return get_ai_status(state);
    }

    if let Ok(mut s) = state.ai_status.lock() {
        s["installed"] = Value::Bool(false);
        s["installing"] = Value::Bool(false);
        s["progress"] = Value::String("".to_string());
        s["error"] = Value::String("".to_string());
        let _ = app.emit("ai-status", s.clone());
    }
    save_ai_status_internal(&app, state.inner());
    get_ai_status(state)
}

#[tauri::command]
fn get_duplicate_result(state: State<'_, AppState>) -> Value {
    state
        .duplicate_result
        .lock()
        .map(|v| v.clone())
        .unwrap_or_else(|_| {
            json!({
              "mode": "duplicates",
              "groups": [],
              "total": 0,
              "copies": 0
            })
        })
}

#[tauri::command]
fn start_duplicate_sort(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mode: Option<String>,
) -> Value {
    let ru = is_ru(&app);
    if let Ok(mut running) = state.sort_running.lock() {
        if *running {
            return json!({"ok": false, "error": if ru { "Сортировка уже выполняется" } else { "Sorting is already running" }});
        }
        *running = true;
    }

    let requested_mode = mode
        .unwrap_or_else(|| "duplicates".to_string())
        .to_lowercase();
    let organize_mode = requested_mode == "organize" || requested_mode == "organized";

    let index = load_index_for_queries(&app, state.inner());
    let mut items: Vec<Value> = index.files.values().cloned().collect();
    items.retain(|item| {
        let p = get_value_str(item, "path");
        if p.is_empty() || !Path::new(p).exists() {
            return false;
        }
        let ext = get_value_str(item, "ext").to_lowercase();
        matches!(ext.as_str(), ".doc" | ".docx" | ".xls" | ".xlsx" | ".pdf")
    });

    let total = items.len();
    let _ = app.emit(
        "sort-progress",
        json!({"type":"scan","processed":0,"total":total}),
    );

    if organize_mode {
        let mut grouped: HashMap<String, Vec<Value>> = HashMap::new();

        for (i, item) in items.iter().enumerate() {
            let source_path = PathBuf::from(get_value_str(item, "path"));
            let size = item.get("size").and_then(|x| x.as_u64()).unwrap_or(0);
            let name = source_path
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or(get_value_str(item, "name"))
                .to_string();

            if source_path.exists() {
                let ext = get_value_str(item, "ext").to_lowercase();
                let ext_label = match ext.as_str() {
                    ".doc" | ".docx" => "Word",
                    ".xls" | ".xlsx" => "Excel",
                    ".pdf" => "PDF",
                    _ => {
                        if ru {
                            "Документы"
                        } else {
                            "Documents"
                        }
                    }
                };
                let category = format!("{} - {}", ext_label, category_from_item(item));
                if let Some(parent) = source_path.parent() {
                    let target_dir = parent.join("OfficeGhost Organized").join(&category);
                    let _ = fs::create_dir_all(&target_dir);

                    let target_candidate = target_dir.join(&name);
                    let target_path = unique_target_path(&target_candidate);

                    let mut moved_to = source_path.clone();
                    if source_path != target_path {
                        if fs::rename(&source_path, &target_path).is_ok() {
                            moved_to = target_path;
                        } else if fs::copy(&source_path, &target_path).is_ok() {
                            let _ = fs::remove_file(&source_path);
                            moved_to = target_path;
                        }
                    }

                    grouped.entry(category.clone()).or_default().push(json!({
            "path": moved_to.to_string_lossy().to_string(),
            "name": moved_to.file_name().and_then(|x| x.to_str()).unwrap_or("file").to_string(),
            "size": size,
            "from": source_path.to_string_lossy().to_string()
          }));
                }
            }

            if i % 80 == 0 || i + 1 == total {
                let _ = app.emit(
                    "sort-progress",
                    json!({"type":"scan","processed":i + 1,"total":total}),
                );
            }
        }

        let mut categories: Vec<String> = grouped.keys().cloned().collect();
        categories.sort();

        let mut groups: Vec<Value> = vec![];
        for category in categories {
            let files = grouped.remove(&category).unwrap_or_default();
            if files.is_empty() {
                continue;
            }

            let sample_path = files
                .get(0)
                .and_then(|v| v.get("path"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let folder_path = Path::new(sample_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            groups.push(json!({
        "id": format!("org-{}", groups.len() + 1),
        "reason": if ru { format!("Папка: {}", category) } else { format!("Folder: {}", category) },
        "original": {
          "path": folder_path,
          "name": category,
          "size": 0
        },
        "copies": files
      }));
        }

        let moved_total: usize = groups
            .iter()
            .map(|g| {
                g.get("copies")
                    .and_then(|x| x.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0)
            })
            .sum();

        let payload = json!({
          "mode": "organized",
          "groups": groups,
          "total": total,
          "copies": moved_total
        });

        if let Ok(mut last) = state.duplicate_result.lock() {
            *last = payload.clone();
        }
        if let Ok(mut running) = state.sort_running.lock() {
            *running = false;
        }

        let _ = app.emit(
            "sort-progress",
            json!({"type":"done","processed":total,"total":total}),
        );
        return json!({"ok": true, "mode": "organized", "groups": payload["groups"].clone(), "total": total, "copies": moved_total});
    }

    let mut map: HashMap<String, Vec<Value>> = HashMap::new();
    for (i, item) in items.iter().enumerate() {
        let name = get_value_str(item, "name").to_lowercase();
        let name_key = name
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>();
        let ext = get_value_str(item, "ext").to_lowercase();
        let text = get_value_str(item, "text").to_lowercase();
        let text_key = text
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .take(4000)
            .collect::<String>();
        let pth = get_value_str(item, "path");
        let content_sig = if text_key.chars().count() > 40 {
            let mut hasher = DefaultHasher::new();
            text_key.hash(&mut hasher);
            format!("{:x}", hasher.finish())
        } else {
            file_fingerprint(pth, &format!("{}|{}", name_key, ext))
        };
        let key = format!("{}|{}|{}", ext, name_key, content_sig);
        map.entry(key).or_default().push(item.clone());

        if i % 120 == 0 || i + 1 == total {
            let _ = app.emit(
                "sort-progress",
                json!({"type":"scan","processed":i + 1,"total":total}),
            );
        }
    }

    let mut groups: Vec<Value> = vec![];
    for (_k, mut list) in map {
        if list.len() < 2 {
            continue;
        }
        list.sort_by(|a, b| get_value_str(a, "path").cmp(get_value_str(b, "path")));
        let original = list.remove(0);
        let copies: Vec<Value> = list
            .into_iter()
            .map(|x| {
                json!({
                  "path": x.get("path").cloned().unwrap_or(Value::String("".to_string())),
                  "name": x.get("name").cloned().unwrap_or(Value::String("".to_string())),
                  "size": x.get("size").cloned().unwrap_or(Value::from(0))
                })
            })
            .collect();

        groups.push(json!({
          "id": format!("dup-{}", groups.len() + 1),
          "reason": if ru { "Имя + размер + содержимое" } else { "Name + size + content" },
          "original": {
            "path": original.get("path").cloned().unwrap_or(Value::String("".to_string())),
            "name": original.get("name").cloned().unwrap_or(Value::String("".to_string())),
            "size": original.get("size").cloned().unwrap_or(Value::from(0))
          },
          "copies": copies
        }));
    }

    let copies_total: usize = groups
        .iter()
        .map(|g| {
            g.get("copies")
                .and_then(|x| x.as_array())
                .map(|a| a.len())
                .unwrap_or(0)
        })
        .sum();
    let payload = json!({
      "mode": "duplicates",
      "groups": groups,
      "total": total,
      "copies": copies_total
    });

    if let Ok(mut last) = state.duplicate_result.lock() {
        *last = payload.clone();
    }
    if let Ok(mut running) = state.sort_running.lock() {
        *running = false;
    }

    let _ = app.emit(
        "sort-progress",
        json!({"type":"done","processed":total,"total":total}),
    );
    json!({"ok": true, "mode": "duplicates", "groups": payload["groups"].clone(), "total": total, "copies": copies_total})
}

#[tauri::command]
fn delete_duplicate_files(app: tauri::AppHandle, paths_to_delete: Vec<String>) -> Value {
    let ru = is_ru(&app);
    let unique: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        paths_to_delete
            .into_iter()
            .filter(|p| !p.trim().is_empty() && seen.insert(p.clone()))
            .collect()
    };

    let mut deleted: Vec<String> = vec![];
    let mut failed: Vec<Value> = vec![];

    for p in &unique {
        let pb = PathBuf::from(p);
        if !pb.exists() {
            failed.push(
                json!({"path": p, "error": if ru { "Файл не найден" } else { "File not found" }}),
            );
            continue;
        }
        if pb.is_dir() {
            failed.push(
                json!({"path": p, "error": if ru { "Это не файл" } else { "This is not a file" }}),
            );
            continue;
        }

        match fs::remove_file(&pb) {
            Ok(_) => deleted.push(p.clone()),
            Err(e) => failed.push(json!({"path": p, "error": e.to_string()})),
        }
    }

    if !deleted.is_empty() {
        let mut index = load_index_internal(&app);
        let mut keys_to_remove: Vec<String> = vec![];
        for (k, v) in index.files.iter() {
            let p = v.get("path").and_then(|x| x.as_str()).unwrap_or("");
            if deleted.iter().any(|d| d == p) {
                keys_to_remove.push(k.clone());
            }
        }
        for k in keys_to_remove {
            index.files.remove(&k);
        }

        if let Some(ip) = index_path(&app) {
            ensure_parent(&ip);
            let _ = fs::write(
                ip,
                serde_json::to_string_pretty(&index).unwrap_or_else(|_| "{}".to_string()),
            );
        }
        if let Some(st) = app.try_state::<AppState>() {
            if let Ok(mut cache) = st.index_cache.lock() {
                *cache = index.clone();
            }
        }

        let next = index_status_from_file(&app);
        if let Some(st) = app.try_state::<AppState>() {
            if let Ok(mut s) = st.index_status.lock() {
                *s = next.clone();
            }
        }
        let _ = app.emit("index-status", next);
    }

    json!({"ok": true, "deleted": deleted, "failed": failed})
}

#[tauri::command]
fn ask_ai_blocking(
    app: tauri::AppHandle,
    state: AppState,
    query: String,
    file_paths: Vec<String>,
    history: Vec<Value>,
    use_documents: bool,
) -> Value {
    let ru = is_ru(&app);
    let q = sanitize_process_input(query.trim());
    if q.is_empty() {
        return json!({"ok": false, "error": if ru { "Пустой запрос" } else { "Empty query" }});
    }

    let context_items = if use_documents { collect_context_from_index(&app, &state, &q, 14) } else { vec![] };
    let attached: Vec<Value> = file_paths
        .iter()
        .take(8)
        .map(|p| read_user_file_context(&app, p))
        .collect();

    if history.is_empty() && !use_documents {
        if let Some(quick) = quick_chat_reply(&q) {
            return json!({"ok": true, "answer": quick, "provider": "built-in"});
        }
    }

    let has_attached_context = attached.iter().any(|x| {
        let content = get_value_str(x, "content");
        !content.is_empty()
            && !content.starts_with("[File not found]")
            && !content.starts_with("[Content not extracted")
    });

    let has_context = !context_items.is_empty() || has_attached_context;
    if use_documents && !has_context {
        return json!({"ok": true, "answer": if ru { "Пока не нашел релевантных данных в локальных файлах. Попробуй уточнить ФИО/ключевые слова или добавь нужный файл в диалог." } else { "I couldn't find relevant data in local files yet. Try clarifying names/keywords or attach the needed file to the chat." }});
    }

    let context_block = context_items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            format!(
                "[#{}] {}\n{}",
                i + 1,
                sanitize_process_input(get_value_str(item, "path")),
                sanitize_process_input(get_value_str(item, "snippet"))
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let attached_block = attached
        .iter()
        .enumerate()
        .map(|(i, item)| {
            format!(
                "[File {}] {}\n{}",
                i + 1,
                sanitize_process_input(get_value_str(item, "path")),
                sanitize_process_input(get_value_str(item, "content"))
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let history_block = history
        .iter()
        .rev()
        .take(24)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|item| {
            let role = item.get("role").and_then(|value| value.as_str()).unwrap_or("user");
            let content = item.get("content").and_then(|value| value.as_str()).unwrap_or("");
            format!("{}: {}", role, sanitize_process_input(&content.chars().take(1800).collect::<String>()))
        })
        .collect::<Vec<_>>()
        .join("\n");

    let lang = load_settings_internal(&app).language;
    let is_ru = lang.eq_ignore_ascii_case("ru");

    let prompt = if is_ru && use_documents {
        format!(
"Ты AI-помощник OfficeGhost.

Обязательные правила:
1) Отвечай ТОЛЬКО на основе блоков 'Контекст из индекса' и 'Вложенные файлы'.
2) Ничего не выдумывай и не добавляй сведения вне найденных фрагментов.
3) Игнорируй регистр (строчные/заглавные) и мелкие орфографические отличия.
4) Ищи смысл запроса, а не только точное совпадение слов.
5) Собирай итог сразу из нескольких релевантных фрагментов, если они есть.
6) Если данных мало, скажи это простыми словами и попроси 1 конкретное уточнение.
7) Пиши естественно, по-человечески, без бюрократических заголовков.
8) По умолчанию 3-8 предложений; если пользователь просит подробно — отвечай подробнее.
9) Если пользователь просит создать файл, сначала дай краткий ответ по сути запроса, без служебных пометок.

История прошлых чатов:
{}

Запрос пользователя:
{}

Контекст из индекса:
{}

Вложенные файлы:
{}
",
    if history_block.is_empty() {"[нет]"} else {&history_block},
    q,
    if context_block.is_empty() {"[пусто]"} else {&context_block},
    if attached_block.is_empty() {"[нет]"} else {&attached_block}
    )
    } else if !is_ru && use_documents {
        format!(
            "You are OfficeGhost AI assistant.

Mandatory rules:
1) Use ONLY data from 'Indexed context' and 'Attached files'.
2) Do not invent facts or add information outside the retrieved fragments.
3) Ignore case differences and minor spelling variations.
4) Match by meaning, not only exact keywords.
5) Merge relevant fragments into one coherent answer.
6) If data is insufficient, say it clearly and ask exactly one clarifying question.
7) Write naturally, concise and friendly.
8) Default length is 3-8 sentences; if user asks for detail, provide more.
9) If user asks to create a file, still answer the request first in plain text.

Previous chat history:
{}

User query:
{}

Indexed context:
{}

Attached files:
{}
",
            if history_block.is_empty() { "[none]" } else { &history_block },
            q,
            if context_block.is_empty() {
                "[empty]"
            } else {
                &context_block
            },
            if attached_block.is_empty() {
                "[none]"
            } else {
                &attached_block
            }
        )
    } else if is_ru {
        format!("Ты OfficeGhost — дружелюбный AI-помощник. Продолжай разговор с учётом истории прошлых чатов. Не утверждай, что искал файлы: поиск сейчас не запрашивался.\n\nИстория:\n{}\n\nСообщение пользователя:\n{}", if history_block.is_empty() { "[нет]" } else { &history_block }, q)
    } else {
        format!("You are OfficeGhost, a friendly AI assistant. Continue the conversation using previous chat history. Do not claim to have searched files because document search was not requested.\n\nHistory:\n{}\n\nUser message:\n{}", if history_block.is_empty() { "[none]" } else { &history_block }, q)
    };

    let prompt_clean = sanitize_process_input(&prompt);

    let settings = load_settings_internal(&app);
    if let Ok(answer) = call_cloud_ai(&settings, &prompt_clean) {
        return json!({"ok": true, "answer": answer, "provider": "officeghost-cloud"});
    }

    let model = selected_model_from_settings(&app);
    let use_model = is_model_available(&model);
    if !use_model {
        if !use_documents {
            return json!({"ok": false, "error": if is_ru { "Нет подключения к облачному ИИ. Подключитесь к интернету или установите локальную модель." } else { "Cloud AI is unavailable. Connect to the internet or install a local model." }});
        }
        let mut lines: Vec<String> = vec![if is_ru {
            "Локальная модель сейчас недоступна, но я нашел это в проиндексированных файлах:"
        } else {
            "Local model is currently unavailable, but I found this in indexed files:"
        }
        .to_string()];
        for item in context_items.iter().take(8) {
            let p = sanitize_process_input(get_value_str(item, "path"));
            let sn = sanitize_process_input(get_value_str(item, "snippet"));
            lines.push(format!("{}: {}", if is_ru { "Файл" } else { "File" }, p));
            if !sn.is_empty() {
                lines.push(format!("{}", sn.chars().take(260).collect::<String>()));
            }
        }
        return json!({"ok": true, "answer": lines.join("\n\n"), "provider": "local"});
    }

    let prompt_arg = sanitize_process_input(&prompt_clean);
    let (code, stdout, stderr) = run_command_capture_timeout(
        "ollama",
        &["run", &model, &prompt_arg],
        Duration::from_secs(60),
    );
    if code == 124 {
        let mut lines: Vec<String> = vec![if is_ru {
            "Модель отвечает дольше обычного. Ниже быстрый ответ по индексу:"
        } else {
            "The model is taking too long. Here is a quick answer from the index:"
        }
        .to_string()];
        for item in context_items.iter().take(6) {
            let p = sanitize_process_input(get_value_str(item, "path"));
            let sn = sanitize_process_input(get_value_str(item, "snippet"));
            lines.push(format!("{}: {}", if is_ru { "Файл" } else { "File" }, p));
            if !sn.is_empty() {
                lines.push(sn.chars().take(220).collect::<String>());
            }
        }
        return json!({"ok": true, "answer": lines.join("\n\n"), "provider": "local", "timeout": true});
    }
    if code != 0 {
        let err = if !stderr.trim().is_empty() {
            stderr
        } else {
            stdout
        };
        if let Ok(mut s) = state.ai_status.lock() {
            s["error"] = Value::String(err.trim().to_string());
            let _ = app.emit("ai-status", s.clone());
        }
        return json!({"ok": false, "error": if err.trim().is_empty() { if is_ru { "Ошибка ИИ" } else { "AI error" } } else {err.trim()}});
    }

    let answer = stdout.trim();
    json!({
      "ok": true,
      "answer": if answer.is_empty() { if is_ru { "Пустой ответ от модели." } else { "Empty response from model." } } else {answer},
      "model": model,
      "provider": "local"
    })
}

#[tauri::command]
async fn ask_ai(
    app: tauri::AppHandle,
    query: String,
    file_paths: Vec<String>,
    history: Vec<Value>,
    use_documents: bool,
) -> Result<Value, String> {
    let ru = is_ru(&app);
    let st = app.state::<AppState>().inner().clone();
    let out =
        tauri::async_runtime::spawn_blocking(move || ask_ai_blocking(app, st, query, file_paths, history, use_documents))
            .await
            .map_err(|e| {
                if ru {
                    format!("Ошибка ИИ: {}", e)
                } else {
                    format!("AI error: {}", e)
                }
            })?;
    Ok(out)
}

#[tauri::command]
fn create_file_from_ai(payload: Value) -> Value {
    let query = payload.get("query").and_then(|x| x.as_str()).unwrap_or("");
    let answer = payload.get("answer").and_then(|x| x.as_str()).unwrap_or("");

    let Some(ext) = detect_create_file_intent(query) else {
        return json!({"ok": false, "skipped": true});
    };
    let empty = should_create_empty_file(query);
    let file_content = if empty {
        "".to_string()
    } else {
        sanitize_process_input(answer)
    };

    match create_file_on_desktop(&ext, &file_content) {
        Ok(path) => json!({
          "ok": true,
          "path": path.to_string_lossy().to_string(),
          "name": path.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "AI_Result".to_string()),
          "ext": ext
        }),
        Err(e) => json!({"ok": false, "error": e}),
    }
}

#[tauri::command]
fn get_system_profile() -> Value {
    let cpu = std::thread::available_parallelism()
        .map(|x| x.get())
        .unwrap_or(1);
    json!({
      "platform": std::env::consts::OS,
      "arch": std::env::consts::ARCH,
      "cpuCount": cpu,
      "totalMemGb": 0
    })
}

#[tauri::command]
fn get_recommended_model() -> String {
    let cpu = std::thread::available_parallelism()
        .map(|x| x.get())
        .unwrap_or(1);
    if cpu <= 4 {
        "qwen2.5:1.5b".to_string()
    } else {
        "qwen2.5:3b".to_string()
    }
}

#[tauri::command]
fn start_indexing(app: tauri::AppHandle, state: State<'_, AppState>) -> Value {
    start_indexing_internal(&app, state.inner(), false)
}

#[tauri::command]
fn pause_indexing(app: tauri::AppHandle, state: State<'_, AppState>) -> Value {
    pause_indexing_internal(&app, state.inner())
}

#[tauri::command]
fn refresh_index(app: tauri::AppHandle, state: State<'_, AppState>) -> Value {
    start_indexing_internal(&app, state.inner(), true)
}

#[cfg(test)]
mod document_tests {
    use super::*;
    use std::io::Read;

    fn temp_file(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("officeghost-test-{}-{}", now_stamp(), name))
    }

    #[test]
    fn creates_valid_docx_package_with_unicode_text() {
        let path = temp_file("result.docx");
        write_docx(&path, "Отчёт OfficeGhost\nВторая строка").expect("docx creation");
        let file = fs::File::open(&path).expect("docx file");
        let mut archive = zip::ZipArchive::new(file).expect("docx zip");
        let mut document = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document.xml")
            .read_to_string(&mut document)
            .expect("xml");
        assert!(document.contains("Отчёт OfficeGhost"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn creates_valid_xlsx_package_with_unicode_text() {
        let path = temp_file("result.xlsx");
        write_xlsx(&path, "Категория,Сумма\nМаркетинг,125000").expect("xlsx creation");
        let file = fs::File::open(&path).expect("xlsx file");
        let mut archive = zip::ZipArchive::new(file).expect("xlsx zip");
        let mut sheet = String::new();
        archive
            .by_name("xl/worksheets/sheet1.xml")
            .expect("sheet.xml")
            .read_to_string(&mut sheet)
            .expect("xml");
        assert!(sheet.contains("Маркетинг,125000"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn removes_search_commands_from_document_query() {
        assert_eq!(
            normalize_search_query("Найди мне учеников в документах"),
            "учеников"
        );
        assert_eq!(
            normalize_search_query("Find students in my files"),
            "students"
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .setup(|app| {
            migrate_legacy_user_data(&app.handle().clone());

            #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
            app.deep_link().register_all()?;

            let auth_app = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_desktop_auth_url(&auth_app, url.as_str());
                }
            });

            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    handle_desktop_auth_url(&app.handle().clone(), url.as_str());
                }
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let state = app.state::<AppState>();
            refresh_index_cache(&app.handle().clone(), state.inner());
            let initial = index_status_from_file(&app.handle().clone());
            if let Ok(mut s) = state.index_status.lock() {
                *s = initial.clone();
            }
            let _ = app.emit("index-status", initial.clone());

            if initial
                .get("fileCount")
                .and_then(|x| x.as_i64())
                .unwrap_or(0)
                == 0
            {
                let app_handle = app.handle().clone();
                let app_state = state.inner().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(2));
                    let _ = start_indexing_internal(&app_handle, &app_state, false);
                });
            }

            let settings = load_settings_internal(&app.handle().clone());
            let _ = apply_hotkey(&app.handle().clone(), &settings.hotkey);
            let _ = setup_tray(&app.handle().clone());

            if let Ok(mut last) = state.last_schedule_run.lock() {
                *last = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
            }

            {
                let app_handle = app.handle().clone();
                let app_state = state.inner().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(Duration::from_secs(20));
                    let st = load_settings_internal(&app_handle);
                    if !st.schedule_enabled || st.paused {
                        continue;
                    }
                    if app_state
                        .worker
                        .lock()
                        .ok()
                        .and_then(|w| w.as_ref().cloned())
                        .is_some()
                    {
                        continue;
                    }
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                    let interval = (st.schedule_minutes.max(1) * 60) as i64;
                    let mut should_run = false;
                    if let Ok(mut last) = app_state.last_schedule_run.lock() {
                        if now - *last >= interval {
                            *last = now;
                            should_run = true;
                        }
                    }
                    if should_run {
                        let _ = start_indexing_internal(&app_handle, &app_state, true);
                    }
                });
            }

            load_ai_status_internal(&app.handle().clone(), state.inner());
            emit_ai_status(&app.handle().clone(), state.inner());

            {
                let app_handle = app.handle().clone();
                let app_state = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = check_app_update_internal(&app_handle, &app_state, false).await;
                });
            }

            {
                let app_handle = app.handle().clone();
                let app_state = state.inner().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(Duration::from_secs(6 * 60 * 60));
                    let _ = tauri::async_runtime::block_on(check_app_update_internal(
                        &app_handle,
                        &app_state,
                        false,
                    ));
                });
            }

            if let Some(main) = app.get_webview_window("main") {
                let st = load_settings_internal(&app.handle().clone());
                if st.remember_pos {
                    apply_saved_main_position(&app.handle().clone());
                } else {
                    let _ = main.center();
                    ensure_main_window_in_screen(&app.handle().clone());
                }

                let app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::Moved(position) = event {
                        let mut st = load_settings_internal(&app_handle);
                        if st.remember_pos {
                            st.window_pos = Some(json!({"x": position.x, "y": position.y}));
                            save_settings_internal(&app_handle, &st);
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_auth,
            begin_desktop_auth,
            sign_out_desktop,
            open_path,
            open_in_folder,
            hide_window,
            begin_drag,
            set_window_height,
            open_settings,
            close_settings,
            open_sort_window,
            close_sort_window,
            begin_drag_sort,
            resize_sort_window,
            get_report_path,
            open_report,
            get_settings,
            choose_index_folder,
            choose_chat_files,
            update_settings,
            get_index_status,
            search,
            get_ai_status,
            install_ai,
            remove_ai,
            get_duplicate_result,
            start_duplicate_sort,
            delete_duplicate_files,
            ask_ai,
            create_file_from_ai,
            get_system_profile,
            get_recommended_model,
            get_app_update_status,
            check_app_update,
            install_app_update,
            start_indexing,
            pause_indexing,
            refresh_index
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
