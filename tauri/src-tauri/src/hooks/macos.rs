//! macOS global input listener: one listen-only CGEventTap for keys and
//! mouse. It never touches the keyboard-layout APIs that crash when called
//! off the main thread (which is what rules out the popular `rdev` crate),
//! it only reads the physical key code and the mouse position.
//!
//! macOS withholds keyboard events until the user allows the app under
//! System Settings > Privacy & Security > Input Monitoring. Mouse events
//! still arrive without it, which is why clicks can count while keys
//! don't. A tap created before access was granted usually keeps getting
//! no keys even after the user allows it, so when access shows up later
//! we report NeedsRestart until a key actually comes through.

use super::keymap::mac_label;
use super::types::{HookStatus, Report, Sink};
use core_foundation::base::TCFType;
use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType, CallbackResult, EventField,
};
use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
    fn CGEventTapIsEnabled(tap: *const c_void) -> bool;
}

/// Which flag bit tells us a modifier key went down (vs up) when macOS
/// reports a FlagsChanged event for that key code.
fn modifier_flag(code: u16) -> Option<CGEventFlags> {
    match code {
        56 | 60 => Some(CGEventFlags::CGEventFlagShift),
        59 | 62 => Some(CGEventFlags::CGEventFlagControl),
        58 | 61 => Some(CGEventFlags::CGEventFlagAlternate),
        55 | 54 => Some(CGEventFlags::CGEventFlagCommand),
        57 => Some(CGEventFlags::CGEventFlagAlphaShift),
        63 => Some(CGEventFlags::CGEventFlagSecondaryFn),
        _ => None,
    }
}

const PERMISSION_HELP: &str = "KeyCount needs Input Monitoring to count keys. Open Input Monitoring settings and switch \
KeyCount on. If it is already on, select KeyCount, remove it with the minus button, then reopen KeyCount and allow it \
again. Each new version of KeyCount needs this once.";

const RESTART_HELP: &str = "Input Monitoring is allowed. Restart KeyCount so macOS starts sending it your keystrokes.";

fn has_access() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

/// Status for a running tap. `key_seen` wins: if a key came through, the
/// tap works whatever the permission check says.
fn tap_status(allowed: bool, allowed_at_start: bool, key_seen: bool) -> HookStatus {
    if key_seen || (allowed && allowed_at_start) {
        HookStatus::Running
    } else if allowed {
        HookStatus::NeedsRestart(RESTART_HELP.into())
    } else {
        HookStatus::NeedsPermission(PERMISSION_HELP.into())
    }
}

/// Blocks forever on the calling thread (it runs a CFRunLoop).
pub fn run(sink: Arc<dyn Sink>, report: Report) {
    // Shows the system prompt the first time and adds KeyCount to the list.
    let mut allowed = has_access();
    if !allowed {
        allowed = unsafe { CGRequestListenEventAccess() };
    }
    let allowed_at_start = allowed;
    let key_seen = Arc::new(AtomicBool::new(false));

    let events = vec![
        CGEventType::KeyDown,
        CGEventType::FlagsChanged,
        CGEventType::LeftMouseDown,
        CGEventType::RightMouseDown,
        CGEventType::OtherMouseDown,
        CGEventType::MouseMoved,
        CGEventType::LeftMouseDragged,
        CGEventType::RightMouseDragged,
        CGEventType::OtherMouseDragged,
    ];

    let cb_sink = sink.clone();
    let cb_key_seen = key_seen.clone();
    let tap = CGEventTap::new(
        CGEventTapLocation::Session,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        events,
        move |_proxy, etype, event| {
            match etype {
                CGEventType::KeyDown => {
                    cb_key_seen.store(true, Ordering::Relaxed);
                    let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
                    match mac_label(code) {
                        Some(label) => cb_sink.key(label),
                        None => cb_sink.key(&format!("key_{code}")),
                    }
                }
                CGEventType::FlagsChanged => {
                    cb_key_seen.store(true, Ordering::Relaxed);
                    let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
                    if let Some(flag) = modifier_flag(code) {
                        if event.get_flags().contains(flag) {
                            if let Some(label) = mac_label(code) {
                                cb_sink.key(label);
                            }
                        }
                    }
                }
                CGEventType::LeftMouseDown | CGEventType::RightMouseDown | CGEventType::OtherMouseDown => {
                    cb_sink.click();
                }
                CGEventType::MouseMoved
                | CGEventType::LeftMouseDragged
                | CGEventType::RightMouseDragged
                | CGEventType::OtherMouseDragged => {
                    let p = event.location();
                    cb_sink.motion(p.x, p.y);
                }
                _ => {}
            }
            CallbackResult::Keep
        },
    );

    let tap = match tap {
        Ok(t) => t,
        Err(()) => {
            // No tap at all. Keep watching so the window can tell the user
            // to restart once access is granted, instead of staying stuck
            // on the permission message.
            loop {
                report(if has_access() {
                    HookStatus::NeedsRestart(RESTART_HELP.into())
                } else {
                    HookStatus::NeedsPermission(PERMISSION_HELP.into())
                });
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    };
    let source = match tap.mach_port().create_runloop_source(0) {
        Ok(s) => s,
        Err(()) => {
            report(HookStatus::Failed("could not start input tracking".into()));
            return;
        }
    };
    CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
    tap.enable();

    loop {
        report(tap_status(allowed, allowed_at_start, key_seen.load(Ordering::Relaxed)));
        // Wake once a second to notice if macOS switched the tap off (it
        // does that if a callback is ever too slow) and turn it back on.
        CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, Duration::from_secs(1), false);
        let enabled = unsafe { CGEventTapIsEnabled(tap.mach_port().as_concrete_TypeRef() as *const c_void) };
        if !enabled {
            tap.enable();
        }
        allowed = has_access();
    }
}
