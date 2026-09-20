use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition, WindowEvent,
};

/// 右键菜单独立窗口的标签（见 tauri.conf.json）
const MENU_WINDOW: &str = "pet-menu";
/// 设置独立窗口的标签（见 tauri.conf.json）
const SETTINGS_WINDOW: &str = "pet-settings";
/// 宠物主窗口标签
const MAIN_WINDOW: &str = "main";
/// 菜单窗口的逻辑尺寸，需与 ContextMenu.vue / ui.css 保持一致
const MENU_SIZE: (f64, f64) = (176.0, 244.0);

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn SetWindowPos(
        hwnd: isize,
        insert_after: isize,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
}

#[cfg(windows)]
const SWP_NOMOVE: u32 = 0x0002;
#[cfg(windows)]
const SWP_NOZORDER: u32 = 0x0004;
#[cfg(windows)]
const SWP_NOACTIVATE: u32 = 0x0010;

/// 退出整个应用
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 设置宠物窗口大小。
///
/// 主窗口为了去掉那圈阴影设置了 `"shadow": false`，而 Windows 上禁用阴影会让窗口
/// 变为"不可调整大小"，此时 Tauri 的 `setSize` 不会生效；因此这里直接调用 Win32
/// `SetWindowPos` 改窗口尺寸，保证"宠物大小"设置在任何情况下都可用。
#[tauri::command]
fn set_pet_size(window: tauri::WebviewWindow, size: f64) -> Result<(), String> {
    let size = size.clamp(120.0, 800.0);

    #[cfg(windows)]
    {
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let px = (size * scale).round() as i32;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let ok = unsafe {
            SetWindowPos(
                hwnd,
                0,
                0,
                0,
                px,
                px,
                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
            )
        };
        if ok == 0 {
            return Err("SetWindowPos 调用失败".into());
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        window
            .set_size(tauri::LogicalSize::new(size, size))
            .map_err(|e| e.to_string())
    }
}

/// 在鼠标位置弹出右键菜单窗口，并做屏幕边界收敛，保证菜单完整可见
#[tauri::command]
fn show_context_menu(app: tauri::AppHandle) -> Result<(), String> {
    let menu = app
        .get_webview_window(MENU_WINDOW)
        .ok_or_else(|| "菜单窗口不存在".to_string())?;

    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let mut x = cursor.x;
    let mut y = cursor.y;

    // 靠近屏幕右下角时向左/上收敛，避免菜单被挤出可用区域
    if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
        let scale = monitor.scale_factor();
        let (w, h) = (MENU_SIZE.0 * scale, MENU_SIZE.1 * scale);
        let work = monitor.work_area();
        let left = f64::from(work.position.x);
        let top = f64::from(work.position.y);
        let right = left + f64::from(work.size.width);
        let bottom = top + f64::from(work.size.height);

        if x + w > right {
            x = right - w;
        }
        if y + h > bottom {
            y = bottom - h;
        }
        x = x.max(left);
        y = y.max(top);
    }

    menu.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    menu.show().map_err(|e| e.to_string())?;
    menu.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 隐藏右键菜单窗口
#[tauri::command]
fn hide_context_menu(app: tauri::AppHandle) {
    if let Some(menu) = app.get_webview_window(MENU_WINDOW) {
        let _ = menu.hide();
    }
}

/// 显示设置窗口（独立窗口，不受宠物窗口尺寸限制）
#[tauri::command]
fn show_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(SETTINGS_WINDOW)
        .ok_or_else(|| "设置窗口不存在".to_string())?;
    if !win.is_visible().unwrap_or(false) {
        let _ = win.center();
    }
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// 隐藏设置窗口
#[tauri::command]
fn hide_settings_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(SETTINGS_WINDOW) {
        let _ = win.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            exit_app,
            set_pet_size,
            show_context_menu,
            hide_context_menu,
            show_settings_window,
            hide_settings_window
        ])
        .setup(|app| {
            // 菜单窗口失焦即隐藏，等价于"点击菜单外部关闭菜单"
            if let Some(menu) = app.get_webview_window(MENU_WINDOW) {
                let handle = app.handle().clone();
                menu.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        if let Some(win) = handle.get_webview_window(MENU_WINDOW) {
                            let _ = win.hide();
                        }
                    }
                });
            }

            // 设置窗口点关闭按钮时只隐藏，下次打开可秒开
            if let Some(settings) = app.get_webview_window(SETTINGS_WINDOW) {
                let handle = app.handle().clone();
                settings.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(win) = handle.get_webview_window(SETTINGS_WINDOW) {
                            let _ = win.hide();
                        }
                    }
                });
            }

            let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏宠物", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "暂停 / 恢复动画", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &pause, &settings, &quit])?;

            TrayIconBuilder::with_id("pet-tray")
                .icon(
                    app.default_window_icon()
                        .expect("missing default window icon")
                        .clone(),
                )
                .tooltip("tauri-desktop-pet")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => {
                        if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                    "pause" => {
                        let _ = app.emit("tray://toggle-pause", ());
                    }
                    // 交给前端统一处理：弹出设置窗口并同步当前配置
                    "settings" => {
                        let _ = app.emit("tray://open-settings", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
