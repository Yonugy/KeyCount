//! Which app currently has focus, best effort. Returns "unknown" whenever
//! the OS can't say. Only the app's short name is read, never window titles
//! or contents.

#[cfg(target_os = "macos")]
pub fn foreground_app() -> String {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    };

    // The window list is already front-to-back; the first layer-0 window is
    // the focused app's. (NSWorkspace.frontmostApplication is avoided on
    // purpose: it goes stale unless a Cocoa run loop is delivering
    // notifications.)
    let windows = match copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    ) {
        Some(w) => w,
        None => return "unknown".into(),
    };
    let layer_key = CFString::from_static_string("kCGWindowLayer");
    let owner_key = CFString::from_static_string("kCGWindowOwnerName");
    for item in windows.iter() {
        let dict: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(*item as CFDictionaryRef) };
        let layer = dict.find(&layer_key).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i32());
        if layer == Some(0) {
            if let Some(owner) = dict.find(&owner_key).and_then(|v| v.downcast::<CFString>()) {
                let name = owner.to_string();
                if !name.is_empty() {
                    return name;
                }
            }
            return "unknown".into();
        }
    }
    "unknown".into()
}

#[cfg(target_os = "windows")]
pub fn foreground_app() -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return "unknown".into();
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return "unknown".into();
        }
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return "unknown".into(),
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        if result.is_err() {
            return "unknown".into();
        }
        exe_stem(&String::from_utf16_lossy(&buf[..len as usize]))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn foreground_app() -> String {
    "unknown".into()
}

/// "C:\\Program Files\\Google\\Chrome\\chrome.exe" -> "chrome". Pure, so it
/// is tested on every OS.
#[allow(dead_code)]
pub fn exe_stem(path: &str) -> String {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let name = if name.len() > 4 && name[name.len() - 4..].eq_ignore_ascii_case(".exe") {
        &name[..name.len() - 4]
    } else {
        name
    };
    if name.is_empty() {
        "unknown".into()
    } else {
        name.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::exe_stem;

    #[test]
    fn exe_paths_become_short_app_names() {
        assert_eq!(exe_stem(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), "chrome");
        assert_eq!(exe_stem(r"C:\Windows\System32\notepad.EXE"), "notepad");
        assert_eq!(exe_stem("code.exe"), "code");
        assert_eq!(exe_stem(r"C:\tools\weird"), "weird");
        assert_eq!(exe_stem(""), "unknown");
        assert_eq!(exe_stem(r"C:\x\.exe"), ".exe"); // a file literally named ".exe" keeps its name
    }
}
