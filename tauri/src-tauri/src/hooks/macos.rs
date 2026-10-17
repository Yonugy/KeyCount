//! macOS global input listener: one listen-only CGEventTap for keys and
//! mouse. It never touches the keyboard-layout APIs that crash when called
//! off the main thread (which is what rules out the popular `rdev` crate),
//! it only reads the physical key code and the mouse position.
//!
//! macOS withholds these events until the user allows the app under
//! System Settings > Privacy & Security > Input Monitoring, and a running
//! process only starts receiving them after it is relaunched.

use super::keymap::mac_label;
use super::types::{HookStatus, Report, Sink};
use core_foundation::base::TCFType;
use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType, CallbackResult, EventField,
};
use std::os::raw::c_void;
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

const PERMISSION_HELP: &str = "macOS is blocking keyboard and mouse access. Open System Settings, Privacy & Security, \
Input Monitoring, switch KeyCount on, then quit and reopen KeyCount.";

/// Blocks forever on the calling thread (it runs a CFRunLoop).
pub fn run(sink: Arc<dyn Sink>, report: Report) {
    // Shows the system prompt the first time and adds KeyCount to the list.
    let mut allowed = unsafe { CGPreflightListenEventAccess() };
    if !allowed {
        allowed = unsafe { CGRequestListenEventAccess() };
    }

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
    let tap = CGEventTap::new(
        CGEventTapLocation::Session,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        events,
        move |_proxy, etype, event| {
            match etype {
                CGEventType::KeyDown => {
                    let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
                    match mac_label(code) {
                        Some(label) => cb_sink.key(label),
                        None => cb_sink.key(&format!("key_{code}")),
                    }
                }
                CGEventType::FlagsChanged => {
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
            report(HookStatus::NeedsPermission(PERMISSION_HELP.into()));
            return;
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
        report(if allowed { HookStatus::Running } else { HookStatus::NeedsPermission(PERMISSION_HELP.into()) });
        // Wake once a second to notice if macOS switched the tap off (it
        // does that if a callback is ever too slow) and turn it back on.
        CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, Duration::from_secs(1), false);
        let enabled = unsafe { CGEventTapIsEnabled(tap.mach_port().as_concrete_TypeRef() as *const c_void) };
        if !enabled {
            tap.enable();
        }
        allowed = unsafe { CGPreflightListenEventAccess() };
    }
}
