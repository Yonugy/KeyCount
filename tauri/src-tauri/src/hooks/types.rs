//! Types shared by every platform's input listener. Kept free of any
//! platform or Tauri code so each listener can be type-checked on its own.

use std::sync::Arc;

/// Where raw input events go. Implemented by the tracker adapter in lib.rs.
/// Callbacks run inside the OS hook, so implementations must be quick.
pub trait Sink: Send + Sync + 'static {
    /// A key went down. `label` is a physical-key name like "a", "space",
    /// "backspace", "shift". Never text content.
    fn key(&self, label: &str);
    fn click(&self);
    fn motion(&self, x: f64, y: f64);
}

#[derive(Debug, Clone, PartialEq)]
pub enum HookStatus {
    Starting,
    Running,
    /// The OS is withholding input access until the user allows it.
    NeedsPermission(String),
    Failed(String),
    /// No listener for this OS (only Windows and macOS are built).
    Unsupported,
}

pub type Report = Arc<dyn Fn(HookStatus) + Send + Sync>;
