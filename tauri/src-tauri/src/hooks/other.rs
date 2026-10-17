//! Platforms without a listener (Linux and friends). KeyCount ships for
//! Windows and macOS; this exists so the project still builds elsewhere.

use super::types::{HookStatus, Report, Sink};
use std::sync::Arc;

pub fn run(_sink: Arc<dyn Sink>, report: Report) {
    report(HookStatus::Unsupported);
}
