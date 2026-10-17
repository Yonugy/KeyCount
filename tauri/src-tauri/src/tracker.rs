//! The counting logic, ported from agent.py's `Agent` class: per-minute
//! buckets split by app, the local-only per-key table, and idle sessions.
//!
//! Nothing here touches the OS. Input hooks call `on_key` / `on_click` /
//! `on_move`, a timer thread calls `tick`, and the foreground app comes in
//! through a shared string that a separate watcher thread keeps fresh
//! (hook callbacks must stay fast, so they never query the OS themselves).
//! Every time-dependent method takes `now` explicitly so tests are exact.

use crate::store::Store;
use chrono::{Local, TimeZone};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

pub const FLUSH_INTERVAL_S: f64 = 60.0; // roll the in-memory bucket to disk every minute
pub const IDLE_THRESHOLD_S: f64 = 60.0; // no input for this long ends the session

#[derive(Default)]
struct State {
    keystrokes: i64,
    backspaces: i64,
    clicks: i64,
    distance_px: i64,
    /// app -> (keystrokes, backspaces) within the current bucket
    app_counts: HashMap<String, (i64, i64)>,
    /// (key, app, local_date) -> presses, local only
    key_counts: HashMap<(String, String, String), i64>,
    bucket_start: i64,
    last_flush: f64,
    last_event_ts: f64,
    last_mouse: Option<(f64, f64)>,
    session_active: bool,
    session_id: Option<i64>,
    /// set when a session starts, written to the database by the next tick
    /// so the hook callback itself never waits on disk
    session_row_pending: Option<f64>,
}

pub struct Tracker {
    state: Mutex<State>,
    store: Arc<Store>,
    current_app: Arc<RwLock<String>>,
    last_error: Mutex<Option<String>>,
}

/// What the window shows.
#[derive(Debug, Clone, PartialEq)]
pub struct TodaySnapshot {
    pub keystrokes: i64,
    pub clicks: i64,
    pub active: bool,
}

pub fn minute_start(ts: f64) -> i64 {
    (ts as i64) / 60 * 60
}

pub fn local_date(ts: f64) -> String {
    match Local.timestamp_opt(ts as i64, 0).earliest() {
        Some(dt) => dt.format("%Y-%m-%d").to_string(),
        None => "unknown".to_string(),
    }
}

/// Unix time of local midnight for the day containing `ts`.
pub fn day_start(ts: f64) -> i64 {
    let dt = match Local.timestamp_opt(ts as i64, 0).earliest() {
        Some(d) => d,
        None => return ts as i64,
    };
    let midnight = dt.date_naive().and_hms_opt(0, 0, 0).unwrap();
    Local
        .from_local_datetime(&midnight)
        .earliest()
        .map(|d| d.timestamp())
        .unwrap_or(ts as i64)
}

pub fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

impl Tracker {
    pub fn new(store: Arc<Store>, current_app: Arc<RwLock<String>>, now: f64) -> Tracker {
        let state = State {
            bucket_start: minute_start(now),
            last_flush: now,
            last_event_ts: now,
            ..Default::default()
        };
        Tracker { state: Mutex::new(state), store, current_app, last_error: Mutex::new(None) }
    }

    fn app(&self) -> String {
        self.current_app.read().map(|a| a.clone()).unwrap_or_else(|_| "unknown".into())
    }

    fn touch(s: &mut State, now: f64) {
        s.last_event_ts = now;
        if !s.session_active {
            s.session_active = true;
            s.session_row_pending = Some(now);
        }
    }

    // --- input events (called from the hook threads) ---

    pub fn on_key(&self, label: &str, now: f64) {
        let app = self.app();
        let mut s = self.state.lock().unwrap();
        Self::touch(&mut s, now);
        s.keystrokes += 1;
        let is_backspace = label == "backspace";
        if is_backspace {
            s.backspaces += 1;
        }
        let e = s.app_counts.entry(app.clone()).or_insert((0, 0));
        e.0 += 1;
        if is_backspace {
            e.1 += 1;
        }
        *s.key_counts.entry((label.to_string(), app, local_date(now))).or_insert(0) += 1;
    }

    pub fn on_click(&self, now: f64) {
        let mut s = self.state.lock().unwrap();
        Self::touch(&mut s, now);
        s.clicks += 1;
    }

    pub fn on_move(&self, x: f64, y: f64, now: f64) {
        let mut s = self.state.lock().unwrap();
        Self::touch(&mut s, now);
        if let Some((px, py)) = s.last_mouse {
            let (dx, dy) = (x - px, y - py);
            s.distance_px += (dx * dx + dy * dy).sqrt() as i64;
        }
        s.last_mouse = Some((x, y));
    }

    // --- timer ---

    /// Called about once a second.
    pub fn tick(&self, now: f64) {
        // persist a newly started session, then close it if input went quiet
        let (pending_start, to_end) = {
            let mut s = self.state.lock().unwrap();
            let pending = s.session_row_pending.take();
            let mut end = None;
            if s.session_active && s.session_row_pending.is_none() && pending.is_none() {
                if now - s.last_event_ts > IDLE_THRESHOLD_S {
                    s.session_active = false;
                    end = s.session_id.take().map(|id| (id, s.last_event_ts));
                }
            }
            (pending, end)
        };
        if let Some(start) = pending_start {
            match self.store.start_session(start as i64, IDLE_THRESHOLD_S as i64) {
                Ok(id) => {
                    let mut s = self.state.lock().unwrap();
                    s.session_id = Some(id);
                }
                Err(e) => self.record_error(format!("could not record session: {e}")),
            }
        }
        if let Some((id, ended)) = to_end {
            if let Err(e) = self.store.end_session(id, ended as i64) {
                self.record_error(format!("could not close session: {e}"));
            }
        }

        let due = {
            let s = self.state.lock().unwrap();
            now - s.last_flush >= FLUSH_INTERVAL_S
        };
        if due {
            self.flush(now);
        }
    }

    /// Writes this minute's counts to events_buffer as one row per app that
    /// had keystrokes, with mouse activity folded into whichever app has focus
    /// at flush time (same behavior as agent.py's flush_bucket).
    pub fn flush(&self, now: f64) {
        let flush_app = self.app();
        let (bucket_start, mut apps, clicks, distance, keys) = {
            let mut s = self.state.lock().unwrap();
            let snapshot = (
                s.bucket_start,
                std::mem::take(&mut s.app_counts),
                std::mem::take(&mut s.clicks),
                std::mem::take(&mut s.distance_px),
                std::mem::take(&mut s.key_counts),
            );
            s.keystrokes = 0;
            s.backspaces = 0;
            s.bucket_start = minute_start(now);
            s.last_flush = now;
            snapshot
        };
        apps.entry(flush_app.clone()).or_insert((0, 0));
        for (app, (ks, bs)) in &apps {
            let is_flush_app = *app == flush_app;
            if let Err(e) = self.store.insert_bucket(
                bucket_start,
                app,
                *ks,
                *bs,
                if is_flush_app { clicks } else { 0 },
                if is_flush_app { distance } else { 0 },
            ) {
                self.record_error(format!("could not save activity: {e}"));
            }
        }
        if !keys.is_empty() {
            let rows: Vec<_> = keys.into_iter().collect();
            if let Err(e) = self.store.bump_keys(&rows) {
                self.record_error(format!("could not save key counts: {e}"));
            }
        }
    }

    /// Final flush when the app quits.
    pub fn shutdown(&self, now: f64) {
        self.flush(now);
        let end = {
            let mut s = self.state.lock().unwrap();
            s.session_active = false;
            s.session_id.take().map(|id| (id, s.last_event_ts))
        };
        if let Some((id, ended)) = end {
            let _ = self.store.end_session(id, ended as i64);
        }
    }

    // --- read side ---

    /// Today's totals: what's on disk plus what's still waiting for the
    /// next flush, so the numbers move as you type.
    pub fn today(&self, now: f64) -> TodaySnapshot {
        let (disk_keys, disk_clicks) = self.store.today_totals(day_start(now)).unwrap_or((0, 0));
        let s = self.state.lock().unwrap();
        TodaySnapshot {
            keystrokes: disk_keys + s.keystrokes,
            clicks: disk_clicks + s.clicks,
            active: s.session_active,
        }
    }

    /// Seconds since the last input event (used to slow the app watcher down
    /// when nobody is typing).
    pub fn idle_for(&self, now: f64) -> f64 {
        let s = self.state.lock().unwrap();
        (now - s.last_event_ts).max(0.0)
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error.lock().unwrap().clone()
    }

    fn record_error(&self, msg: String) {
        *self.last_error.lock().unwrap() = Some(msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A fixed instant (2026-10-01 12:00:30 UTC). Tests only depend on
    // relative offsets and on local_date()/day_start(), which they compute
    // with the same helpers, so the machine's timezone doesn't matter.
    const T0: f64 = 1_790_000_430.0;

    fn setup() -> (Tracker, Arc<Store>, Arc<RwLock<String>>) {
        let store = Arc::new(Store::open_in_memory().unwrap());
        let app = Arc::new(RwLock::new("code".to_string()));
        (Tracker::new(store.clone(), app.clone(), T0), store, app)
    }

    #[test]
    fn keystrokes_split_across_apps_and_clicks_go_to_flush_app() {
        let (t, store, app) = setup();
        for i in 0..5 {
            t.on_key("a", T0 + i as f64);
        }
        t.on_key("backspace", T0 + 5.0);
        *app.write().unwrap() = "chrome".into(); // alt-tab mid-minute
        for i in 0..3 {
            t.on_key("b", T0 + 10.0 + i as f64);
        }
        t.on_click(T0 + 20.0);
        t.on_click(T0 + 21.0);
        t.flush(T0 + 60.0);

        let rows = store.unsynced_batch(500).unwrap();
        assert_eq!(rows.len(), 2);
        let code = rows.iter().find(|r| r.app_name == "code").unwrap();
        let chrome = rows.iter().find(|r| r.app_name == "chrome").unwrap();
        assert_eq!((code.keystrokes, code.backspaces, code.mouse_clicks), (6, 1, 0));
        assert_eq!((chrome.keystrokes, chrome.backspaces, chrome.mouse_clicks), (3, 0, 2));
        assert_eq!(code.bucket_start_ts, minute_start(T0));
    }

    #[test]
    fn mouse_only_minute_still_produces_one_row_and_empty_minute_none() {
        let (t, store, _app) = setup();
        t.on_move(0.0, 0.0, T0);
        t.on_move(3.0, 4.0, T0 + 1.0); // 5 px
        t.on_move(3.0, 14.0, T0 + 2.0); // 10 px
        t.on_click(T0 + 3.0);
        t.flush(T0 + 60.0);
        let rows = store.unsynced_batch(500).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].keystrokes, rows[0].mouse_clicks, rows[0].mouse_distance_px), (0, 1, 15));

        t.flush(T0 + 120.0); // nothing happened: no new row
        assert_eq!(store.unsynced_batch(500).unwrap().len(), 1);
    }

    #[test]
    fn today_includes_not_yet_flushed_activity() {
        let (t, _store, _app) = setup();
        t.on_key("a", T0);
        t.on_key("a", T0 + 1.0);
        t.on_click(T0 + 2.0);
        let snap = t.today(T0 + 3.0);
        assert_eq!((snap.keystrokes, snap.clicks, snap.active), (2, 1, true));
        t.flush(T0 + 60.0);
        let snap = t.today(T0 + 61.0);
        assert_eq!((snap.keystrokes, snap.clicks), (2, 1)); // same total, now from disk
    }

    #[test]
    fn tick_flushes_on_schedule_and_ends_idle_sessions() {
        let (t, store, _app) = setup();
        t.on_key("a", T0);
        t.tick(T0 + 1.0); // persists the session row
        t.tick(T0 + 30.0);
        assert!(store.unsynced_batch(10).unwrap().is_empty(), "not due yet");
        assert!(t.today(T0 + 30.0).active);

        t.tick(T0 + 61.0); // flush due; also 61s since last input -> idle
        assert_eq!(store.unsynced_batch(10).unwrap().len(), 1);
        assert!(!t.today(T0 + 61.0).active);
        assert!(t.last_error().is_none());
    }

    #[test]
    fn per_key_counts_are_saved_with_local_date_and_app() {
        let (t, store, _app) = setup();
        t.on_key("a", T0);
        t.on_key("a", T0 + 1.0);
        t.on_key("space", T0 + 2.0);
        t.flush(T0 + 60.0);
        let date = local_date(T0);
        assert_eq!(store.top_keys(10, Some("code"), Some(&date)).unwrap(), vec![("a".into(), 2), ("space".into(), 1)]);
        assert_eq!(store.app_totals(Some(&date)).unwrap(), vec![("code".into(), 3)]);
    }

    #[test]
    fn day_start_is_local_midnight() {
        let ds = day_start(T0);
        assert!(ds as f64 <= T0 && T0 - (ds as f64) < 86_400.0 + 3_600.0);
        assert_eq!(local_date(ds as f64), local_date(T0));
        assert_ne!(local_date(ds as f64 - 1.0), local_date(T0));
    }

    #[test]
    fn shutdown_flushes_pending_counts() {
        let (t, store, _app) = setup();
        t.on_key("a", T0);
        t.shutdown(T0 + 5.0);
        assert_eq!(store.unsynced_batch(10).unwrap().len(), 1);
    }
}
