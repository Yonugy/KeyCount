//! Local SQLite storage. Same file and same tables as the Python agent
//! (agent.py's `Store`), on purpose: the Tauri app can pick up an existing
//! registration, local access code and history, and either agent can open
//! the other's database. Don't run both at once though, they'd both count
//! the same keystrokes.
//!
//! PRIVACY: `key_counts` (which physical key, how many times) is local
//! only. It has no `synced` column and nothing in sync.rs reads it.

use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const LOCAL_TOKEN_SETTING: &str = "local_api_token";

/// Same location as the Python agent: %LOCALAPPDATA%\KeyCount on Windows,
/// ~/Library/Application Support/KeyCount on macOS, ~/.local/share/KeyCount
/// elsewhere.
pub fn default_db_path() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("KeyCount").join("keycount.db")
}

pub struct Store {
    conn: Mutex<Connection>,
}

/// One unsynced events_buffer row.
#[derive(Debug, Clone, PartialEq)]
pub struct BucketRow {
    pub id: i64,
    pub bucket_start_ts: i64,
    pub app_name: String,
    pub keystrokes: i64,
    pub backspaces: i64,
    pub mouse_clicks: i64,
    pub mouse_distance_px: i64,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Store> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        // The Python agent may have the file open too (or a crashed run left
        // a journal behind), wait a moment instead of failing right away.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let store = Store { conn: Mutex::new(conn) };
        store.migrate()?;
        Ok(store)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Store> {
        let store = Store { conn: Mutex::new(Connection::open_in_memory()?) };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS events_buffer (
                 id INTEGER PRIMARY KEY,
                 bucket_start_ts INTEGER,
                 app_name TEXT,
                 window_title TEXT,
                 keystrokes INTEGER,
                 backspaces INTEGER,
                 mouse_clicks INTEGER,
                 mouse_distance_px INTEGER,
                 synced BOOLEAN DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS sessions (
                 id INTEGER PRIMARY KEY,
                 started_at INTEGER,
                 ended_at INTEGER,
                 idle_gap_threshold_s INTEGER
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key TEXT PRIMARY KEY,
                 value TEXT
             );",
        )?;

        // key_counts history, same in-place migrations as agent.py so a
        // database from any older Python version still opens cleanly:
        //   v1 (key_name, count)
        //   v2 (key_name, app_name, count)            <- app_name added
        //   v3 (key_name, app_name, local_date, count) <- local_date added
        let cols = table_columns(&conn, "key_counts")?;
        const V3: &str = "CREATE TABLE key_counts (
                key_name TEXT NOT NULL,
                app_name TEXT NOT NULL,
                local_date TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (key_name, app_name, local_date)
            )";
        if cols.is_empty() {
            conn.execute_batch(V3)?;
        } else if !cols.iter().any(|c| c == "app_name") {
            // v1 -> v3
            conn.execute_batch(&format!(
                "ALTER TABLE key_counts RENAME TO key_counts_old;
                 {V3};
                 INSERT INTO key_counts (key_name, app_name, local_date, count)
                     SELECT key_name, 'unknown', 'unknown', count FROM key_counts_old;
                 DROP TABLE key_counts_old;"
            ))?;
        } else if !cols.iter().any(|c| c == "local_date") {
            // v2 -> v3
            conn.execute_batch(&format!(
                "ALTER TABLE key_counts RENAME TO key_counts_old;
                 {V3};
                 INSERT INTO key_counts (key_name, app_name, local_date, count)
                     SELECT key_name, app_name, 'unknown', count FROM key_counts_old;
                 DROP TABLE key_counts_old;"
            ))?;
        }
        Ok(())
    }

    // --- events_buffer ---

    pub fn insert_bucket(
        &self,
        bucket_start_ts: i64,
        app_name: &str,
        keystrokes: i64,
        backspaces: i64,
        mouse_clicks: i64,
        mouse_distance_px: i64,
    ) -> rusqlite::Result<()> {
        if keystrokes == 0 && mouse_clicks == 0 && mouse_distance_px == 0 {
            return Ok(());
        }
        self.conn.lock().unwrap().execute(
            "INSERT INTO events_buffer
                 (bucket_start_ts, app_name, keystrokes, backspaces,
                  mouse_clicks, mouse_distance_px, synced)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            params![bucket_start_ts, app_name, keystrokes, backspaces, mouse_clicks, mouse_distance_px],
        )?;
        Ok(())
    }

    pub fn today_totals(&self, day_start_ts: i64) -> rusqlite::Result<(i64, i64)> {
        self.conn.lock().unwrap().query_row(
            "SELECT COALESCE(SUM(keystrokes), 0), COALESCE(SUM(mouse_clicks), 0)
             FROM events_buffer WHERE bucket_start_ts >= ?1",
            params![day_start_ts],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
    }

    pub fn unsynced_batch(&self, limit: i64) -> rusqlite::Result<Vec<BucketRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, bucket_start_ts, COALESCE(app_name, 'unknown'), keystrokes, backspaces,
                    mouse_clicks, mouse_distance_px
             FROM events_buffer WHERE synced = 0
             ORDER BY bucket_start_ts LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(BucketRow {
                id: r.get(0)?,
                bucket_start_ts: r.get(1)?,
                app_name: r.get(2)?,
                keystrokes: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                backspaces: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                mouse_clicks: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                mouse_distance_px: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
            })
        })?;
        rows.collect()
    }

    pub fn mark_synced(&self, ids: &[i64]) -> rusqlite::Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for id in ids {
            tx.execute("UPDATE events_buffer SET synced = 1 WHERE id = ?1", params![id])?;
        }
        tx.commit()
    }

    // --- sessions ---

    pub fn start_session(&self, started_at: i64, idle_threshold_s: i64) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (started_at, idle_gap_threshold_s) VALUES (?1, ?2)",
            params![started_at, idle_threshold_s],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn end_session(&self, session_id: i64, ended_at: i64) -> rusqlite::Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE sessions SET ended_at = ?1 WHERE id = ?2",
            params![ended_at, session_id],
        )?;
        Ok(())
    }

    // --- settings ---

    pub fn get_setting(&self, key: &str) -> Option<String> {
        self.conn
            .lock()
            .unwrap()
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
            .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// The access code for the dashboard's Keys tab, created on first use.
    pub fn local_token(&self) -> String {
        if let Some(t) = self.get_setting(LOCAL_TOKEN_SETTING) {
            if !t.is_empty() {
                return t;
            }
        }
        let mut bytes = [0u8; 16];
        // Falls back to a clock-derived value only if the OS RNG fails,
        // which in practice it doesn't.
        if getrandom::fill(&mut bytes).is_err() {
            let n = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            bytes.copy_from_slice(&n.to_le_bytes());
        }
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let _ = self.set_setting(LOCAL_TOKEN_SETTING, &token);
        token
    }

    // --- key_counts (local only) ---

    /// `counts` maps (key_name, app_name, local_date) -> increment.
    pub fn bump_keys(&self, counts: &[((String, String, String), i64)]) -> rusqlite::Result<()> {
        if counts.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        for ((key, app, date), n) in counts {
            tx.execute(
                "INSERT INTO key_counts (key_name, app_name, local_date, count) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(key_name, app_name, local_date) DO UPDATE SET count = count + excluded.count",
                params![key, app, date, n],
            )?;
        }
        tx.commit()
    }

    /// Totals per key, most pressed first, optionally narrowed to one app
    /// and/or one local day. Same semantics as agent.py's `top_keys`.
    pub fn top_keys(&self, n: i64, app: Option<&str>, date: Option<&str>) -> rusqlite::Result<Vec<(String, i64)>> {
        let mut clauses: Vec<&str> = Vec::new();
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(a) = app {
            clauses.push("app_name = ?");
            args.push(a.to_string().into());
        }
        if let Some(d) = date {
            clauses.push("local_date = ?");
            args.push(d.to_string().into());
        }
        let where_sql = if clauses.is_empty() { String::new() } else { format!("WHERE {}", clauses.join(" AND ")) };
        args.push(n.into());
        let sql = format!(
            "SELECT key_name, SUM(count) AS total FROM key_counts {where_sql}
             GROUP BY key_name ORDER BY total DESC, key_name ASC LIMIT ?"
        );
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(args), |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    /// Keystrokes per app, most active first; `date` scopes to one local day.
    pub fn app_totals(&self, date: Option<&str>) -> rusqlite::Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let map = |r: &rusqlite::Row| -> rusqlite::Result<(String, i64)> { Ok((r.get(0)?, r.get(1)?)) };
        match date {
            Some(d) => {
                let mut stmt = conn.prepare(
                    "SELECT app_name, SUM(count) AS total FROM key_counts
                     WHERE local_date = ?1 GROUP BY app_name ORDER BY total DESC, app_name ASC",
                )?;
                let rows = stmt.query_map(params![d], map)?;
                rows.collect()
            }
            None => {
                let mut stmt = conn.prepare(
                    "SELECT app_name, SUM(count) AS total FROM key_counts
                     GROUP BY app_name ORDER BY total DESC, app_name ASC",
                )?;
                let rows = stmt.query_map([], map)?;
                rows.collect()
            }
        }
    }

    pub fn known_apps(&self) -> rusqlite::Result<Vec<String>> {
        Ok(self.app_totals(None)?.into_iter().map(|(a, _)| a).collect())
    }
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt.query_map([], |r| r.get::<_, String>(1))?;
    cols.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(key: &str, app: &str, date: &str) -> (String, String, String) {
        (key.to_string(), app.to_string(), date.to_string())
    }

    #[test]
    fn fresh_db_has_current_key_counts_shape() {
        let s = Store::open_in_memory().unwrap();
        let conn = s.conn.lock().unwrap();
        let cols = table_columns(&conn, "key_counts").unwrap();
        assert_eq!(cols, vec!["key_name", "app_name", "local_date", "count"]);
    }

    #[test]
    fn migrates_v1_and_v2_key_counts_without_losing_history() {
        // v1 shape: (key_name, count)
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE key_counts (key_name TEXT PRIMARY KEY, count INTEGER);
             INSERT INTO key_counts VALUES ('a', 5), ('b', 2);",
        )
        .unwrap();
        let s = Store { conn: Mutex::new(conn) };
        s.migrate().unwrap();
        assert_eq!(s.top_keys(10, None, None).unwrap(), vec![("a".into(), 5), ("b".into(), 2)]);
        // old data lands on app 'unknown' and date 'unknown'
        assert_eq!(s.app_totals(None).unwrap(), vec![("unknown".into(), 7)]);
        assert!(s.app_totals(Some("2026-10-01")).unwrap().is_empty());

        // v2 shape: (key_name, app_name, count)
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE key_counts (key_name TEXT NOT NULL, app_name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key_name, app_name));
             INSERT INTO key_counts VALUES ('a', 'code', 3), ('a', 'chrome', 4);",
        )
        .unwrap();
        let s = Store { conn: Mutex::new(conn) };
        s.migrate().unwrap();
        assert_eq!(s.top_keys(10, None, None).unwrap(), vec![("a".into(), 7)]);
        assert_eq!(s.top_keys(10, Some("code"), None).unwrap(), vec![("a".into(), 3)]);
    }

    #[test]
    fn bump_keys_accumulates_and_filters_combine() {
        let s = Store::open_in_memory().unwrap();
        s.bump_keys(&[(k("a", "code", "2026-10-01"), 3), (k("b", "code", "2026-10-01"), 1), (k("a", "chrome", "2026-10-02"), 5)])
            .unwrap();
        s.bump_keys(&[(k("a", "code", "2026-10-01"), 2)]).unwrap();
        assert_eq!(s.top_keys(10, None, None).unwrap(), vec![("a".into(), 10), ("b".into(), 1)]);
        assert_eq!(s.top_keys(10, Some("code"), None).unwrap(), vec![("a".into(), 5), ("b".into(), 1)]);
        assert_eq!(s.top_keys(10, None, Some("2026-10-02")).unwrap(), vec![("a".into(), 5)]);
        assert_eq!(s.top_keys(10, Some("code"), Some("2026-10-01")).unwrap(), vec![("a".into(), 5), ("b".into(), 1)]);
        assert_eq!(s.top_keys(1, None, None).unwrap().len(), 1);
        assert_eq!(s.known_apps().unwrap(), vec!["chrome".to_string(), "code".to_string()].into_iter().rev().collect::<Vec<_>>());
    }

    #[test]
    fn empty_buckets_are_skipped_and_sync_marking_works() {
        let s = Store::open_in_memory().unwrap();
        s.insert_bucket(60, "code", 0, 0, 0, 0).unwrap(); // all zero: skipped
        s.insert_bucket(120, "code", 10, 2, 1, 300).unwrap();
        s.insert_bucket(180, "chrome", 4, 0, 0, 0).unwrap();
        let rows = s.unsynced_batch(500).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].bucket_start_ts, 120);
        assert_eq!(rows[0].keystrokes, 10);
        s.mark_synced(&[rows[0].id]).unwrap();
        let left = s.unsynced_batch(500).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].app_name, "chrome");
        assert_eq!(s.today_totals(0).unwrap(), (14, 1));
        assert_eq!(s.today_totals(150).unwrap(), (4, 0));
    }

    #[test]
    fn settings_and_local_token_persist() {
        let s = Store::open_in_memory().unwrap();
        assert_eq!(s.get_setting("x"), None);
        s.set_setting("x", "1").unwrap();
        s.set_setting("x", "2").unwrap();
        assert_eq!(s.get_setting("x").as_deref(), Some("2"));
        let t1 = s.local_token();
        let t2 = s.local_token();
        assert_eq!(t1, t2);
        assert_eq!(t1.len(), 32);
    }
}
