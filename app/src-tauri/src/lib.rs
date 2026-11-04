//! MW for Windows: a small tray shell around the hosted Market Widget page.
//! The page does all market work; this shell adds the tray, close-to-tray,
//! start with Windows, always-on-top, a global hotkey and native toasts.
//! Information only: nothing here can trade or touch a brokerage.

use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow, WindowEvent, Wry,
};

#[cfg(desktop)]
use tauri_plugin_autostart::ManagerExt as _;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

const AUTOSTART_ARG: &str = "--autostart";
/// The bundled launcher page (Windows serves app files from http://tauri.localhost).
#[cfg(windows)]
const LAUNCHER_URL: &str = "http://tauri.localhost/index.html";
#[cfg(not(windows))]
const LAUNCHER_URL: &str = "tauri://localhost/index.html";
/// If the page stops checking in for this long, the shell warns and reloads it.
const WATCHDOG_SECS: u64 = 180;

/// Preferences that belong to the shell (the page keeps its own in its storage).
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Prefs {
    on_top: bool,
    start_hidden: bool,
    hotkey: bool,
    tray_hint_shown: bool,
    first_run_done: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { on_top: false, start_hidden: false, hotkey: true, tray_hint_shown: false, first_run_done: false }
    }
}

struct Shell {
    prefs: Mutex<Prefs>,
    tray: Mutex<Option<TrayIcon<Wry>>>,
    items: Mutex<Option<TrayItems>>,
    icon_state: Mutex<&'static str>,
    heartbeat: Mutex<Instant>,
    watchdog_fired: Mutex<bool>,
    hotkey_ok: Mutex<bool>,
}

struct TrayItems {
    show: MenuItem<Wry>,
    on_top: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    start_hidden: CheckMenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
}

#[derive(Serialize)]
struct AppState {
    version: String,
    on_top: bool,
    autostart: bool,
    start_hidden: bool,
    hotkey: bool,
    hotkey_ok: bool,
    hotkey_label: &'static str,
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("shell-prefs.json"))
}

fn load_prefs(app: &AppHandle) -> Prefs {
    prefs_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_prefs(app: &AppHandle) {
    let Some(path) = prefs_path(app) else { return };
    let prefs = app.state::<Shell>().prefs.lock().unwrap().clone();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&prefs) {
        let _ = fs::write(path, json);
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    refresh_tray_labels(app);
}

fn hide_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.hide();
    }
    let first_time = {
        let shell = app.state::<Shell>();
        let mut p = shell.prefs.lock().unwrap();
        let first = !p.tray_hint_shown;
        p.tray_hint_shown = true;
        first
    };
    if first_time {
        save_prefs(app);
        let _ = app
            .notification()
            .builder()
            .title("MW is still running")
            .body("It keeps watching your alerts from the tray. Click the tray icon or press Ctrl+Alt+M to open it.")
            .show();
    }
    refresh_tray_labels(app);
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && !minimized && focused {
            hide_main(app);
        } else {
            show_main(app);
        }
    }
}

fn refresh_tray_labels(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let items = shell.items.lock().unwrap();
    if let Some(items) = items.as_ref() {
        let visible = main_window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
        let _ = items.show.set_text(if visible { "Hide MW" } else { "Open MW" });
        let p = shell.prefs.lock().unwrap();
        let _ = items.on_top.set_checked(p.on_top);
        let _ = items.start_hidden.set_checked(p.start_hidden);
        #[cfg(desktop)]
        let _ = items.autostart.set_checked(app.autolaunch().is_enabled().unwrap_or(false));
    }
}

#[cfg(desktop)]
fn hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM)
}

/// Apply one shell setting. Returns an error message the page can show.
fn apply_pref(app: &AppHandle, key: &str, value: bool) -> Result<(), String> {
    match key {
        "on_top" => {
            if let Some(w) = main_window(app) {
                w.set_always_on_top(value).map_err(|e| e.to_string())?;
            }
            app.state::<Shell>().prefs.lock().unwrap().on_top = value;
        }
        "start_hidden" => {
            app.state::<Shell>().prefs.lock().unwrap().start_hidden = value;
        }
        #[cfg(desktop)]
        "autostart" => {
            let al = app.autolaunch();
            if value { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
        }
        #[cfg(desktop)]
        "hotkey" => {
            let gs = app.global_shortcut();
            if value {
                if !gs.is_registered(hotkey()) {
                    gs.register(hotkey()).map_err(|_| "Ctrl+Alt+M is already used by another app".to_string())?;
                }
                *app.state::<Shell>().hotkey_ok.lock().unwrap() = true;
            } else if gs.is_registered(hotkey()) {
                let _ = gs.unregister(hotkey());
            }
            app.state::<Shell>().prefs.lock().unwrap().hotkey = value;
        }
        _ => return Err(format!("unknown setting {key}")),
    }
    save_prefs(app);
    refresh_tray_labels(app);
    let _ = app.emit("mw-shell-changed", ());
    Ok(())
}

// ---------- commands the page can call (via window.__TAURI__.core.invoke) ----------

#[tauri::command]
fn shell_state(app: AppHandle) -> AppState {
    let p = app.state::<Shell>().prefs.lock().unwrap().clone();
    #[cfg(desktop)]
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    #[cfg(not(desktop))]
    let autostart = false;
    AppState {
        version: app.package_info().version.to_string(),
        on_top: p.on_top,
        autostart,
        start_hidden: p.start_hidden,
        hotkey: p.hotkey,
        hotkey_ok: *app.state::<Shell>().hotkey_ok.lock().unwrap(),
        hotkey_label: "Ctrl+Alt+M",
    }
}

#[tauri::command]
fn shell_set(app: AppHandle, key: String, value: bool) -> Result<(), String> {
    apply_pref(&app, &key, value)
}

/// Hide to the tray (the page's close button).
#[tauri::command]
fn shell_hide(app: AppHandle) {
    hide_main(&app);
}

#[tauri::command]
fn shell_quit(app: AppHandle) {
    app.exit(0);
}

fn set_tray_icon(app: &AppHandle, state: &'static str) {
    let shell = app.state::<Shell>();
    let mut last = shell.icon_state.lock().unwrap();
    if *last == state {
        return;
    }
    *last = state;
    let bytes: &[u8] = match state {
        "alert" => include_bytes!("../icons/tray-alert.png"),
        "stale" => include_bytes!("../icons/tray-stale.png"),
        _ => include_bytes!("../icons/tray.png"),
    };
    if let Some(tray) = shell.tray.lock().unwrap().as_ref() {
        if let Ok(img) = Image::from_bytes(bytes) {
            let _ = tray.set_icon(Some(img));
        }
    };
}

/// Update the tray: tooltip text, icon (red dot = unseen alerts, amber dot = data
/// is stale or failing) and the pause check mark. Also counts as a heartbeat.
#[tauri::command]
fn shell_tray(app: AppHandle, tooltip: String, alert: bool, stale: bool, paused: bool) {
    let shell = app.state::<Shell>();
    *shell.heartbeat.lock().unwrap() = Instant::now();
    *shell.watchdog_fired.lock().unwrap() = false;
    let tip: String = tooltip.chars().take(120).collect();
    if let Some(tray) = shell.tray.lock().unwrap().as_ref() {
        let _ = tray.set_tooltip(Some(if tip.is_empty() { "MW".to_string() } else { tip }));
    };
    if let Some(items) = shell.items.lock().unwrap().as_ref() {
        let _ = items.pause.set_checked(paused);
    };
    set_tray_icon(&app, if alert { "alert" } else if stale { "stale" } else { "ok" });
}

/// The page (or the launcher) checks in every 30 s so the shell knows it is alive.
#[tauri::command]
fn shell_alive(app: AppHandle) {
    let shell = app.state::<Shell>();
    *shell.heartbeat.lock().unwrap() = Instant::now();
    *shell.watchdog_fired.lock().unwrap() = false;
}

fn reload_launcher(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if let Ok(url) = tauri::Url::parse(LAUNCHER_URL) {
            let _ = w.navigate(url);
        }
    }
}

/// Watchdog: if the page stops checking in (renderer crash, failed load), warn once
/// in the tray and with a toast, then reload through the launcher.
fn start_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        let tick = Instant::now();
        std::thread::sleep(Duration::from_secs(30));
        let shell = app.state::<Shell>();
        // The PC was asleep: give the page a fresh grace period instead of a false alarm.
        if tick.elapsed() > Duration::from_secs(75) {
            *shell.heartbeat.lock().unwrap() = Instant::now();
            continue;
        }
        let silent = shell.heartbeat.lock().unwrap().elapsed() > Duration::from_secs(WATCHDOG_SECS);
        if !silent {
            continue;
        }
        let first = {
            let mut fired = shell.watchdog_fired.lock().unwrap();
            let first = !*fired;
            *fired = true;
            first
        };
        *shell.heartbeat.lock().unwrap() = Instant::now(); // give the reload time to come up
        if first {
            if let Some(tray) = shell.tray.lock().unwrap().as_ref() {
                let _ = tray.set_tooltip(Some("MW: the page stopped responding, reloading…"));
            };
            set_tray_icon(&app, "stale");
            let _ = app
                .notification()
                .builder()
                .title("MW is reloading")
                .body("The widget stopped responding, so alerts were paused. Reloading it now.")
                .show();
        }
        let h = app.clone();
        let _ = app.run_on_main_thread(move || reload_launcher(&h));
    });
}

/// Native toast. `body` is short text from the page.
#[tauri::command]
fn shell_notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title.chars().take(100).collect::<String>())
        .body(body.chars().take(250).collect::<String>())
        .show()
        .map_err(|e| e.to_string())
}

// ---------- app ----------

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // A second launch just brings the running MW to the front.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }));
        builder = builder
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![AUTOSTART_ARG]),
            ))
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            toggle_main(app);
                        }
                    })
                    .build(),
            )
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::all()
                            - tauri_plugin_window_state::StateFlags::VISIBLE
                            - tauri_plugin_window_state::StateFlags::DECORATIONS,
                    )
                    .build(),
            );
    }

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Shell {
            prefs: Mutex::new(Prefs::default()),
            tray: Mutex::new(None),
            items: Mutex::new(None),
            icon_state: Mutex::new("ok"),
            heartbeat: Mutex::new(Instant::now()),
            watchdog_fired: Mutex::new(false),
            hotkey_ok: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            shell_state,
            shell_set,
            shell_hide,
            shell_quit,
            shell_tray,
            shell_alive,
            shell_notify
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let prefs = load_prefs(&handle);
            let first_run = !prefs.first_run_done;
            *app.state::<Shell>().prefs.lock().unwrap() = prefs.clone();

            // First run: start with Windows by default (it can be turned off from the tray or Settings).
            #[cfg(desktop)]
            if first_run {
                let _ = handle.autolaunch().enable();
            }
            if first_run {
                app.state::<Shell>().prefs.lock().unwrap().first_run_done = true;
                save_prefs(&handle);
            }

            // Tray menu.
            let show = MenuItem::with_id(app, "show", "Open MW", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Refresh prices", true, None::<&str>)?;
            let pause = CheckMenuItem::with_id(app, "pause", "Pause alerts for today", true, false, None::<&str>)?;
            let on_top = CheckMenuItem::with_id(app, "on_top", "Always on top", true, prefs.on_top, None::<&str>)?;
            #[cfg(desktop)]
            let auto_on = handle.autolaunch().is_enabled().unwrap_or(false);
            #[cfg(not(desktop))]
            let auto_on = false;
            let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, auto_on, None::<&str>)?;
            let start_hidden =
                CheckMenuItem::with_id(app, "start_hidden", "Start in the tray", true, prefs.start_hidden, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload MW", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit MW", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&show, &refresh, &pause, &sep1, &on_top, &autostart, &start_hidden, &sep2, &reload, &quit],
            )?;

            let tray = TrayIconBuilder::with_id("mw")
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .tooltip("MW")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main(app),
                    "refresh" => {
                        let _ = app.emit("mw-refresh", ());
                    }
                    "pause" => {
                        // the page owns the pause state and sends back the check mark
                        let _ = app.emit("mw-pause", ());
                    }
                    "on_top" => {
                        let v = !app.state::<Shell>().prefs.lock().unwrap().on_top;
                        let _ = apply_pref(app, "on_top", v);
                    }
                    "start_hidden" => {
                        let v = !app.state::<Shell>().prefs.lock().unwrap().start_hidden;
                        let _ = apply_pref(app, "start_hidden", v);
                    }
                    #[cfg(desktop)]
                    "autostart" => {
                        let v = !app.autolaunch().is_enabled().unwrap_or(false);
                        let _ = apply_pref(app, "autostart", v);
                    }
                    "reload" => {
                        reload_launcher(app);
                        show_main(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;

            *app.state::<Shell>().tray.lock().unwrap() = Some(tray);
            *app.state::<Shell>().items.lock().unwrap() =
                Some(TrayItems { show, on_top, autostart, start_hidden, pause });

            // Global hotkey (skip quietly if another app owns it).
            #[cfg(desktop)]
            if prefs.hotkey {
                let ok = handle.global_shortcut().register(hotkey()).is_ok();
                *app.state::<Shell>().hotkey_ok.lock().unwrap() = ok;
            }

            // Window: close (X) hides to the tray instead of quitting.
            if let Some(w) = main_window(&handle) {
                if prefs.on_top {
                    let _ = w.set_always_on_top(true);
                }
                let h = handle.clone();
                w.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main(&h);
                    }
                });
                let launched_at_login = std::env::args().any(|a| a == AUTOSTART_ARG);
                if !(launched_at_login && prefs.start_hidden) {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            refresh_tray_labels(&handle);
            start_watchdog(handle.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building MW")
        .run(|_app, _event| {});
}
