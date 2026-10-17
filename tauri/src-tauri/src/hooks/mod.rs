//! Global keyboard and mouse listeners, one implementation per OS, all
//! feeding the same `Sink`.

pub mod keymap;
pub mod types;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other;

pub use types::{HookStatus, Report, Sink};
use std::sync::Arc;

/// Starts the listener on its own thread and returns immediately. Progress
/// and failures come back through `report`.
pub fn start(sink: Arc<dyn Sink>, report: Report) {
    report(HookStatus::Starting);
    let spawned = std::thread::Builder::new().name("keycount-input".into()).spawn({
        let report = report.clone();
        move || {
            #[cfg(target_os = "macos")]
            macos::run(sink, report);
            #[cfg(target_os = "windows")]
            windows::run(sink, report);
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            other::run(sink, report);
        }
    });
    if let Err(e) = spawned {
        report(HookStatus::Failed(format!("could not start input tracking: {e}")));
    }
}
