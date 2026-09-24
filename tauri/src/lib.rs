use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, WindowEvent, Wry,
};

// One window: the card. Its header strip (close + drag dots) is part of the same webview, so dragging it
// moves the card natively — no second window chasing the first.
const LYRICS: &str = "lyrics";
const HOVER_POLL: Duration = Duration::from_millis(100);
const HOVER_MARGIN: f64 = 12.0; // points around the card that still counts as "over it"

static HOVER_SHOWN: AtomicBool = AtomicBool::new(false);
static USER_HIDDEN: AtomicBool = AtomicBool::new(false); // "Hide float" from the menu
// Last position seen while the card moves; written to disk once it has been still for SAVE_AFTER.
static PENDING_POS: Mutex<Option<(Pos, Instant)>> = Mutex::new(None);
const SAVE_AFTER: Duration = Duration::from_millis(500);

/// Card position in logical points (desktop coordinates). Points, not pixels: pixels depend on the
/// display's scale (2× Retina vs 1× external), so a pixel position is wrong on the other screen.
#[derive(Serialize, Deserialize)]
struct Pos {
    lx: f64,
    ly: f64,
}

// ponytail: the old pixel-based position.json is simply ignored (one-time reset to the default spot)
fn pos_file(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_data_dir().expect("app data dir").join("position.json")
}

/// Is a saved position still on a connected display? (A monitor may have been unplugged since.)
fn on_some_monitor(app: &tauri::AppHandle, p: &Pos) -> bool {
    app.available_monitors().unwrap_or_default().iter().any(|m| {
        let sf = m.scale_factor();
        let (o, s) = (m.position().to_logical::<f64>(sf), m.size().to_logical::<f64>(sf));
        p.lx >= o.x && p.lx < o.x + s.width && p.ly >= o.y && p.ly < o.y + s.height
    })
}

fn load_pos(app: &tauri::AppHandle) -> Option<Pos> {
    std::fs::read_to_string(pos_file(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn save_pos(app: &tauri::AppHandle, p: Pos) {
    if let Ok(s) = serde_json::to_string(&p) {
        let _ = std::fs::write(pos_file(app), s);
    }
}

/// Current lyrics size in logical px, so the grip can resize relative to drag start.
#[tauri::command]
fn lyrics_size(app: tauri::AppHandle) -> Option<(f64, f64)> {
    let l = app.get_webview_window(LYRICS)?;
    let s = l.outer_size().ok()?.to_logical::<f64>(l.scale_factor().ok()?);
    Some((s.width, s.height))
}

// ponytail: manual resize because tao's start_resize_dragging is NotSupported on macOS; bounds mirror tauri.conf.json.
#[tauri::command]
fn resize_lyrics(app: tauri::AppHandle, w: f64, h: f64) {
    let Some(l) = app.get_webview_window(LYRICS) else { return };
    let _ = l.set_size(LogicalSize::new(w.clamp(240.0, 560.0), h.clamp(240.0, 560.0)));
}

/// Copy to the clipboard. The webview blocks both navigator.clipboard and execCommand under tauri://,
/// so pipe it to the platform's clipboard tool — no plugin, no extra dependency.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let tools: &[(&str, &[&str])] = &[("pbcopy", &[])];
    // Wayland first, then X11; whichever the session provides
    #[cfg(not(target_os = "macos"))]
    let tools: &[(&str, &[&str])] = &[
        ("wl-copy", &[]),
        ("xclip", &["-selection", "clipboard"]),
        ("xsel", &["--clipboard", "--input"]),
    ];

    let mut last = String::from("no clipboard tool found");
    for (tool, args) in tools {
        match pipe_to(tool, args, &text) {
            Ok(()) => return Ok(()),
            Err(e) => last = format!("{tool}: {e}"),
        }
    }
    Err(last)
}

fn pipe_to(tool: &str, args: &[&str], text: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = std::process::Command::new(tool)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    match child.wait() {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("exited with {s}")),
        Err(e) => Err(e.to_string()),
    }
}

/// Which OS float is running on, so the UI can hide macOS-only settings.
#[tauri::command]
fn host_platform() -> &'static str {
    std::env::consts::OS
}

/// Keep the card on screen when another app goes fullscreen: tao sets only CanJoinAllSpaces, and
/// macOS needs FullScreenAuxiliary plus a level at or above the status bar's.
#[cfg(target_os = "macos")]
fn join_fullscreen_spaces(w: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
    let Ok(ptr) = w.ns_window() else { return };
    let ns = unsafe { &*(ptr as *const NSWindow) };
    // replaced, not merged: a resizable window carries FullScreenPrimary, which cancels FullScreenAuxiliary
    ns.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary,
    );
    // alwaysOnTop only reaches floating level (3), which a fullscreen app covers
    ns.setLevel(NSStatusWindowLevel);
}

#[cfg(not(target_os = "macos"))]
fn join_fullscreen_spaces(_w: &tauri::WebviewWindow) {}

/// The card. Built here rather than in tauri.conf.json so it is created after the activation policy.
fn build_card(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(app, LYRICS, tauri::WebviewUrl::App("index.html".into()))
        .inner_size(320.0, 318.0)
        .min_inner_size(240.0, 240.0)
        .max_inner_size(560.0, 560.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(true)
        .focused(false)
        .visible(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .build()
}

/// "Frosted glass" setting: real macOS vibrancy behind the card (CSS backdrop-filter can't see the desktop).
#[tauri::command]
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
fn set_frosted(app: tauri::AppHandle, on: bool) {
    #[cfg(not(target_os = "macos"))]
    let _ = (app, on); // window effects are macOS-only; the setting is hidden elsewhere
    #[cfg(target_os = "macos")]
    {
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::window::{Effect, EffectState};
    let Some(l) = app.get_webview_window(LYRICS) else { return };
    let _ = if on {
        l.set_effects(WindowEffectsConfig {
            effects: vec![Effect::HudWindow],
            state: Some(EffectState::Active), // stay frosted even though the card never takes focus
            radius: Some(12.0),                     // matches the card's corner radius
            color: None,
        })
    } else {
        l.set_effects(None)
    };
    }
}

/// Header close button (the tray menu has Quit too). float has no Dock icon (Accessory policy).
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Stored Spotify tokens (JSON written by the frontend), or None before first sign-in.
#[tauri::command]
fn read_auth(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = app.path().app_data_dir().map_err(|e| e.to_string())?.join("auth.json");
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Atomic write, 0600 — the file holds a refresh token.
#[tauri::command]
fn write_auth(app: tauri::AppHandle, json: String) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("auth.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("auth.json")).map_err(|e| e.to_string())
}

/// Is the cursor over the card (plus margin)? The card is click-through when not hovered, so its webview can't see hover.
///
/// Compared in logical points: tao converts the cursor with the PRIMARY display's scale but the window
/// with its OWN display's scale, so on a second monitor with a different scale the pixel values disagree
/// and the card could never be grabbed there.
fn cursor_over_card(app: &tauri::AppHandle) -> Option<bool> {
    let l = app.get_webview_window(LYRICS)?;
    let primary = app.primary_monitor().ok()??.scale_factor();
    let c = app.cursor_position().ok()?.to_logical::<f64>(primary); // global NSEvent location, works unfocused
    let sf = l.scale_factor().ok()?;
    let p = l.outer_position().ok()?.to_logical::<f64>(sf);
    let s = l.outer_size().ok()?.to_logical::<f64>(sf);
    Some(
        c.x >= p.x - HOVER_MARGIN
            && c.x <= p.x + s.width + HOVER_MARGIN
            && c.y >= p.y - HOVER_MARGIN
            && c.y <= p.y + s.height + HOVER_MARGIN,
    )
}

/// ponytail: 10 Hz cursor poll; an NSTrackingArea would need objc and still not fire on a click-through window.
/// The same tick flushes the card position once a drag has settled (never write files mid-drag).
fn spawn_hover_watch(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(HOVER_POLL);
        if let Ok(mut pending) = PENDING_POS.lock() {
            if pending.as_ref().is_some_and(|(_, at)| at.elapsed() >= SAVE_AFTER) {
                if let Some((p, _)) = pending.take() {
                    save_pos(&app, p);
                }
            }
        }
        let Some(over) = cursor_over_card(&app) else { continue };
        let over = over && !USER_HIDDEN.load(Ordering::Relaxed); // a hidden card never reacts to hover
        if over == HOVER_SHOWN.swap(over, Ordering::Relaxed) {
            continue;
        }
        // While hovered the card takes the mouse (header buttons, drag, wheel, grip); otherwise click-through.
        if let Some(w) = app.get_webview_window(LYRICS) {
            let _ = w.set_ignore_cursor_events(!over);
        }
        let _ = app.emit("float:hover", over); // reveals header controls + grip
    });
}

/// The menu-bar tray icon and its menu (the only place for float's controls besides the header's close button).
struct Controls {
    hide: MenuItem<Wry>,
    _tray: TrayIcon<Wry>, // keep the tray icon alive for the app's lifetime
}

fn build_controls(app: &tauri::App) -> tauri::Result<Controls> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let hide = item("hide", "Hide float")?;
    let earlier = item("nudge:+250", "Show lyrics 0.25 s sooner")?;
    let later = item("nudge:-250", "Show lyrics 0.25 s later")?;
    let reset = item("nudge:reset", "Reset this track's timing")?;
    let all = Submenu::with_items(
        app,
        "Lyrics timing — all tracks",
        true,
        &[
            &item("global:+250", "0.25 s sooner")?,
            &item("global:-250", "0.25 s later")?,
            &item("global:reset", "Reset")?,
        ],
    )?;
    let sign_in = item("sign-in", "Sign in to Spotify again")?;
    let quit = item("quit", "Quit float")?;
    let (s1, s2) = (PredefinedMenuItem::separator(app)?, PredefinedMenuItem::separator(app)?);
    let menu = Menu::with_items(app, &[&hide, &s1, &earlier, &later, &reset, &all, &s2, &sign_in, &quit])?;
    let tray = TrayIconBuilder::with_id("float")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true) // macOS tints it for light/dark menu bars
        .tooltip("float")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    Ok(Controls { hide, _tray: tray })
}

/// Hide = fade + click-through (never window.hide(): hidden webviews get their timers throttled).
fn set_hidden(app: &tauri::AppHandle, hidden: bool) {
    USER_HIDDEN.store(hidden, Ordering::Relaxed);
    if let Some(c) = app.try_state::<Controls>() {
        let _ = c.hide.set_text(if hidden { "Show float" } else { "Hide float" });
    }
    if let Some(w) = app.get_webview_window(LYRICS) {
        let _ = w.set_ignore_cursor_events(true); // the hover watcher re-enables when shown + hovered
    }
    HOVER_SHOWN.store(false, Ordering::Relaxed);
    let _ = app.emit("float:hover", false);
    let _ = app.emit("float:visible", !hidden);
}

/// Menu clicks: window-level actions stay in Rust; everything about lyrics/auth goes to the lyrics webview.
fn on_menu(app: &tauri::AppHandle, id: &str) {
    match id {
        "quit" => app.exit(0),
        "hide" => set_hidden(app, !USER_HIDDEN.load(Ordering::Relaxed)),
        _ => {
            let _ = app.emit_to(LYRICS, "float:menu", id);
        }
    }
}

const LYRICS_CACHE_V1: &str = "CREATE TABLE lyrics (
    track_key  TEXT    PRIMARY KEY NOT NULL,
    lrc        TEXT,
    status     TEXT    NOT NULL CHECK (status IN ('synced', 'instrumental', 'none')),
    offset_ms  INTEGER NOT NULL DEFAULT 0,
    source_id  INTEGER,
    fetched_at INTEGER NOT NULL
) STRICT;";

// v2: small key/value store (global lyrics offset, album-art setting). Never edit an applied migration — add a new version.
const SETTINGS_V2: &str = "CREATE TABLE settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;";

// v3: allow status 'plain' (lyrics without timestamps). SQLite can't alter a CHECK constraint, so rebuild
// the table; cached 'none' rows are dropped on purpose (plain-only tracks were stored as 'none' before).
const LYRICS_PLAIN_V3: &str = "CREATE TABLE lyrics_v3 (
    track_key  TEXT    PRIMARY KEY NOT NULL,
    lrc        TEXT,
    status     TEXT    NOT NULL CHECK (status IN ('synced', 'plain', 'instrumental', 'none')),
    offset_ms  INTEGER NOT NULL DEFAULT 0,
    source_id  INTEGER,
    fetched_at INTEGER NOT NULL
) STRICT;
INSERT INTO lyrics_v3 (track_key, lrc, status, offset_ms, source_id, fetched_at)
    SELECT track_key, lrc, status, offset_ms, source_id, fetched_at FROM lyrics WHERE status <> 'none';
DROP TABLE lyrics;
ALTER TABLE lyrics_v3 RENAME TO lyrics;";

fn migrations() -> Vec<tauri_plugin_sql::Migration> {
    vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "create_lyrics_cache",
            sql: LYRICS_CACHE_V1,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "create_settings",
            sql: SETTINGS_V2,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "lyrics_plain_status",
            sql: LYRICS_PLAIN_V3,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ]
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:float.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            lyrics_size,
            resize_lyrics,
            quit,
            copy_text,
            host_platform,
            set_frosted,
            read_auth,
            write_auth
        ])
        .setup(|app| {
            // Order matters: a window created while the app is still a regular Dock app never gets
            // CanJoinAllSpaces honoured, so it can never appear over another app's fullscreen space.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let _ = std::fs::create_dir_all(app.path().app_data_dir()?);
            let l = build_card(app.handle())?;
            if let Some(p) = load_pos(app.handle()).filter(|p| on_some_monitor(app.handle(), p)) {
                let _ = l.set_position(LogicalPosition::new(p.lx, p.ly));
            }
            let _ = l.set_ignore_cursor_events(true); // until the cursor reaches the card
            join_fullscreen_spaces(&l);
            let controls = build_controls(app)?;
            app.manage(controls);
            spawn_hover_watch(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let (WindowEvent::Moved(p), LYRICS) = (event, window.label()) {
                let sf = window.scale_factor().unwrap_or(1.0);
                let l = p.to_logical::<f64>(sf);
                if let Ok(mut pending) = PENDING_POS.lock() {
                    *pending = Some((Pos { lx: l.x, ly: l.y }, Instant::now()));
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running float");
}