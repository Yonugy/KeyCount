//! Windows global input hooks: low-level keyboard and mouse hooks
//! (SetWindowsHookEx WH_KEYBOARD_LL / WH_MOUSE_LL). These need no special
//! permission, but they do need a thread that pumps messages, so that is
//! all this thread does.

use super::keymap::windows_label;
use super::types::{HookStatus, Report, Sink};
use std::sync::{Arc, OnceLock};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_MOUSEMOVE,
    WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_XBUTTONDOWN,
};

// Hook procedures are plain C callbacks with no user-data pointer, so the
// sink has to live in a global.
static SINK: OnceLock<Arc<dyn Sink>> = OnceLock::new();

const HC_ACTION: i32 = 0;

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION {
        let msg = wparam.0 as u32;
        if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
            let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if let (Some(label), Some(sink)) = (windows_label(info.vkCode), SINK.get()) {
                sink.key(&label);
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION {
        if let Some(sink) = SINK.get() {
            match wparam.0 as u32 {
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN => sink.click(),
                WM_MOUSEMOVE => {
                    let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                    sink.motion(info.pt.x as f64, info.pt.y as f64);
                }
                _ => {}
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Blocks forever on the calling thread, which must be dedicated to this.
pub fn run(sink: Arc<dyn Sink>, report: Report) {
    let _ = SINK.set(sink);
    unsafe {
        let module = match GetModuleHandleW(None) {
            Ok(m) => m,
            Err(e) => {
                report(HookStatus::Failed(format!("could not start input tracking: {e}")));
                return;
            }
        };
        let hinstance = Some(module.into());
        if let Err(e) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), hinstance, 0) {
            report(HookStatus::Failed(format!("could not hook the keyboard: {e}")));
            return;
        }
        if let Err(e) = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hinstance, 0) {
            report(HookStatus::Failed(format!("could not hook the mouse: {e}")));
            return;
        }
        report(HookStatus::Running);

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
    }
    report(HookStatus::Failed("input tracking stopped unexpectedly".into()));
}
